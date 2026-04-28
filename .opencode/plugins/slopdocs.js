/**
 * slopdocs plugin for OpenCode
 *
 * Registers the slopdocs skill directory so OpenCode discovers it
 * automatically, and injects a lightweight bootstrap into the first
 * user message of each session so the agent knows to check for and
 * use the slopdocs skill when writing documentation.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, "../../skills");

const extractAndStripFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content };
  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      frontmatter[line.slice(0, idx).trim()] = line
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, content: match[2] };
};

const getBootstrapContent = () => {
  const skillPath = path.join(skillsDir, "slopdocs", "SKILL.md");
  if (!fs.existsSync(skillPath)) return null;
  const { content } = extractAndStripFrontmatter(
    fs.readFileSync(skillPath, "utf8")
  );
  return `<slopdocs-skill>
This project uses the slopdocs convention. The slopdocs skill is available — load it before writing, updating, or deciding whether to create documentation.

${content}
</slopdocs-skill>`;
};

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
      const bootstrap = getBootstrapContent();
      if (!bootstrap || !output.messages.length) return;
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
      firstUser.parts.unshift({ ...ref, type: "text", text: bootstrap });
    },
  };
};
