/**
 * slopdocs plugin for OpenCode
 *
 * Registers the slopdocs skill so OpenCode discovers it automatically, and
 * injects a short bootstrap pointer into each session so the agent knows to
 * load the slopdocs skill when writing documentation. The skill itself
 * contains the full convention; the bootstrap just points to it.
 *
 * Ships one module compatible with both plugin runtimes, following
 * https://opencode.ai/v2/docs/build/plugins/#support-v1:
 *
 * - OpenCode 1.x (`opencode`, 1.18.29+): a module exporting a default
 *   `{ id, server }` is treated as a v1 plugin whose `server(input, options)`
 *   returns the classic hooks object (`config`,
 *   `experimental.chat.messages.transform`, ...).
 * - OpenCode 2 (`opencode2`): a module exporting a default `{ id, setup }`
 *   is a v2 plugin. `setup(ctx)` registers behavior imperatively against
 *   domain-scoped APIs (`ctx.skill.transform`, `ctx.session.hook`, ...)
 *   instead of returning a hooks object.
 *
 * v1 calls `server()` and ignores `setup`; v2 reads `id` and `setup()` and
 * ignores `server`. See slopdocs/features/opencode2-compat.md for the
 * research trail and the traps behind this shape.
 */

import { readdir, readFile } from "fs/promises";
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

// Minimal YAML frontmatter reader. SKILL.md frontmatter is deliberately flat
// `key: value` lines (see AGENTS.md), so this doesn't need a YAML parser.
// Returns { frontmatter, content } where content is the body after the
// closing `---`, matching what OpenCode 2's own SKILL.md loader stores.
function parseSkillFile(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return { frontmatter: {}, content: text };
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    let value = kv[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[kv[1]] = value;
  }
  return { frontmatter, content: text.slice(match[0].length) };
}

// Read every skills/<id>/SKILL.md into the shape OpenCode 2's skill editor
// accepts (Skill.Info: { id, name, description?, location, content }). The
// host validates this with a schema on `editor.add`, so: `id`, `name`,
// `location`, `content` are required strings, `description` must be a string
// or absent (an explicit `undefined` is rejected), and `location` must be the
// absolute path of the SKILL.md — OpenCode lists the sibling files of that
// path when the skill is loaded.
async function loadSkills() {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const location = path.join(skillsDir, entry.name, "SKILL.md");
    let text;
    try {
      text = await readFile(location, "utf8");
    } catch {
      continue;
    }
    const { frontmatter, content } = parseSkillFile(text);
    const id = entry.name;
    skills.push({
      id,
      name: frontmatter.name || id,
      ...(frontmatter.description ? { description: frontmatter.description } : {}),
      location,
      content,
    });
  }
  return skills;
}

async function v2Setup(ctx) {
  // Read files before registering: transform callbacks are synchronous and
  // replayed on every skill reload, so they must not do I/O.
  const skills = await loadSkills();

  // Job 1: register the skill, equivalent to v1's config.skills.paths.push().
  // OpenCode 2's skill editor is { list, get, add, update, remove } over
  // resolved skills (https://opencode.ai/v2/docs/build/plugins/#skills).
  // A skill with the same id that an earlier transform already added — e.g.
  // a copy the user installed manually under .opencode/skills/ — wins.
  if (ctx.skill && typeof ctx.skill.transform === "function") {
    await ctx.skill.transform((editor) => {
      if (typeof editor.add === "function") {
        const taken = new Set(editor.list().map((skill) => skill.id));
        for (const skill of skills) {
          if (!taken.has(skill.id)) editor.add(skill);
        }
        return;
      }
      // Pre-release opencode2 builds exposed a draft with `source()` instead
      // of `add()`. Keep them working; drop this once none are in the wild.
      if (typeof editor.source === "function") {
        const registered = editor
          .list()
          .some((source) => source.type === "directory" && source.path === skillsDir);
        if (!registered) editor.source({ type: "directory", path: skillsDir });
      }
    });
  }

  // Job 2: bootstrap pointer, equivalent to v1's
  // experimental.chat.messages.transform. OpenCode 2 exposes the assembled
  // system prompt for each model call via the session "context" hook
  // (https://opencode.ai/v2/docs/build/plugins/#model-context). The event is
  // rebuilt per call and not persisted, so appending here doesn't stack; the
  // token check guards against another hook or agent having added it first.
  if (ctx.session && typeof ctx.session.hook === "function") {
    await ctx.session.hook("context", (event) => {
      if (!event || !Array.isArray(event.system)) return;
      if (event.system.some((part) => part && hasBootstrap(part.text))) return;
      event.system.push({ type: "text", text: BOOTSTRAP });
    });
  }
}

export default {
  id: "slopdocs",
  server: v1Server,
  setup: v2Setup,
};
