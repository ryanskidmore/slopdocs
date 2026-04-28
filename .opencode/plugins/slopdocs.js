/**
 * slopdocs plugin for OpenCode
 *
 * Registers the slopdocs skill directory so OpenCode discovers it
 * automatically, and injects a short bootstrap pointer into the first
 * user message of each session so the agent knows to load the slopdocs
 * skill when writing documentation. The skill itself contains the full
 * convention; the bootstrap just points to it.
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, "../../skills");

const BOOTSTRAP = `<slopdocs-skill>
This project uses the slopdocs convention for agent-facing documentation (notes from one agent to the next), separate from any human-facing docs like \`docs/\` or \`README.md\`. If the user asks for "docs" without specifying, ask which kind they mean. Load the slopdocs skill before writing or updating agent-facing documentation.
</slopdocs-skill>`;

export const SlopdocsPlugin = async () => {
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
      if (
        firstUser.parts.some(
          (p) => p.type === "text" && p.text.includes("slopdocs-skill")
        )
      )
        return;
      const ref = firstUser.parts[0];
      firstUser.parts.unshift({ ...ref, type: "text", text: BOOTSTRAP });
    },
  };
};
