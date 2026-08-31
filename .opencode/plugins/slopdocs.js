/**
 * slopdocs plugin for OpenCode
 *
 * Registers the slopdocs skill directory so OpenCode discovers it
 * automatically, and injects a short bootstrap pointer into the first
 * user message of each session so the agent knows to load the slopdocs
 * skill when writing documentation. The skill itself contains the full
 * convention; the bootstrap just points to it.
 *
 * Ships one module compatible with both plugin runtimes:
 *
 * - OpenCode 1.x (`opencode`): a module exporting a default `{ id, server }`
 *   is treated as a v1 plugin whose `server(input, options)` returns the
 *   classic hooks object (`config`, `experimental.chat.messages.transform`,
 *   ...). See packages/opencode/src/plugin/shared.ts#readV1Plugin and
 *   packages/opencode/src/plugin/index.ts#applyPlugin in
 *   https://github.com/anomalyco/opencode (formerly sst/opencode).
 * - OpenCode 2 (`opencode2`): a module exporting a default `{ id, setup }`
 *   is a v2 plugin. `setup(ctx)` registers behavior imperatively against
 *   domain-scoped APIs (`ctx.skill.transform`, `ctx.session.hook`, ...)
 *   instead of returning a hooks object. See
 *   packages/core/src/config/plugin/external.ts (loader — validates
 *   `default` as `{id, effect}` or `{id, setup}`) and
 *   packages/plugin/src/v2/{promise,effect}/*.ts (the shipped API surface)
 *   in the same repo.
 *
 * The v2 loader only looks at `default`, so both runtimes are satisfied by
 * one object carrying `server` (v1) and `setup` (v2) side by side — see
 * slopdocs/features/opencode2-compat.md for the full research trail and why
 * a single-hooks-object shape doesn't work for v2.
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, "../../skills");

const BOOTSTRAP = `<slopdocs-skill>
This project uses the slopdocs convention for agent-facing documentation (notes from one agent to the next), separate from any human-facing docs like \`docs/\` or \`README.md\`. If the user asks for "docs" without specifying, ask which kind they mean. Load the slopdocs skill before writing or updating agent-facing documentation.
</slopdocs-skill>`;

const hasBootstrap = (text) =>
  typeof text === "string" && text.includes("slopdocs-skill");

// --- OpenCode 1.x: (input, options) => Promise<Hooks> ---------------------

async function v1Server() {
  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length) return;
      const firstUser = output.messages.find(
        (m) => m.info.role === "user"
      );
      if (!firstUser || !firstUser.parts.length) return;
      if (firstUser.parts.some((p) => p.type === "text" && hasBootstrap(p.text)))
        return;
      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: "text", text: BOOTSTRAP });
    },
  };
}

// --- OpenCode 2: setup(ctx) => void, hooks registered imperatively --------

async function v2Setup(ctx) {
  // Job 1: register skills/ as a skill source, equivalent to v1's
  // config.skills.paths.push(). Draft shape verified against
  // packages/plugin/src/v2/effect/skill.ts (SkillDraft) and the
  // SkillV2DirectorySource union in packages/sdk/js/src/v2/gen/types.gen.ts.
  if (ctx.skill && typeof ctx.skill.transform === "function") {
    await ctx.skill.transform((draft) => {
      const alreadyRegistered =
        typeof draft.list === "function" &&
        draft
          .list()
          .some((source) => source.type === "directory" && source.path === skillsDir);
      if (!alreadyRegistered) {
        draft.source({ type: "directory", path: skillsDir });
      }
    });
  }

  // Job 2: one-time bootstrap pointer, equivalent to v1's
  // experimental.chat.messages.transform. OpenCode 2's session hooks
  // (ctx.session.hook) are documented in @opencode-ai/plugin's published
  // types but, as of this writing, aren't wired up in every opencode2
  // build yet (no SessionDomain implementation exists in
  // packages/core/src/plugin/host.ts on the anomalyco/opencode `dev`
  // branch). Feature-detect so the plugin still loads — and skill
  // registration still works — on builds without it, and so the bootstrap
  // starts working automatically once the hook lands.
  if (ctx.session && typeof ctx.session.hook === "function") {
    try {
      await ctx.session.hook("context", (event) => {
        if (!event || !Array.isArray(event.messages) || !event.messages.length)
          return;
        const firstUser = event.messages.find((m) => m.role === "user");
        if (!firstUser || !Array.isArray(firstUser.content)) return;
        if (
          firstUser.content.some(
            (part) => part.type === "text" && hasBootstrap(part.text)
          )
        )
          return;
        firstUser.content.unshift({ type: "text", text: BOOTSTRAP });
      });
    } catch {
      // Session hooks unavailable on this opencode2 build; skip silently.
    }
  }
}

export default {
  id: "slopdocs",
  server: v1Server,
  setup: v2Setup,
};
