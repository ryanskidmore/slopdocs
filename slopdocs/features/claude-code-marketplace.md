# Claude Code plugin marketplace

This repo is its own Claude Code plugin marketplace, with itself as the only plugin. Install is:

```
/plugin marketplace add ryanskidmore/slopdocs
/plugin install slopdocs@slopdocs
```

## The mechanism

`.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` live side by side in the same `.claude-plugin/` directory at repo root. The marketplace has one plugin entry named `slopdocs`, with `"source": "./"` — i.e. the plugin's root is the marketplace root, which is the repo root. This is the documented "marketplace root plugin" pattern (Claude Code docs: plugin-marketplaces.md, "Advanced plugin entries").

Consequence: `plugin.json` needs no `skills` field. Claude Code auto-scans `skills/` at the plugin root, which is `<repo root>/skills/`, and picks up the existing `skills/slopdocs/SKILL.md` unmodified. Zero duplication of the canonical skill file — this is the same file OpenCode loads.

(The `skills` field on a marketplace-root entry only matters once *more than one* plugin entry shares that root — then you must list subdirectories per entry, or every entry's skills scan collides. We only have one entry, so the default full scan is correct. If a second plugin entry is ever added here, revisit this.)

Validated with `claude plugin validate .` (validates the marketplace + descends into the plugin's own manifest) and `claude plugin validate ./skills` (validates the skill content directly), both clean, including `--strict`. Also smoke-tested end-to-end with `CLAUDE_CONFIG_DIR` pointed at a scratch directory: `claude plugin marketplace add <path>` → `claude plugin install slopdocs@slopdocs` → `claude plugin details slopdocs@slopdocs` reported `Skills (1) slopdocs` with no errors.

## Why no SessionStart bootstrap hook

The OpenCode plugin (`.opencode/plugins/slopdocs.js`) injects a short "this project uses slopdocs" pointer into the first user message of every session, because OpenCode doesn't otherwise surface skill descriptions to the model proactively — the bootstrap is what gets the skill noticed at all.

Claude Code doesn't have that gap: plugin skills are model-invoked directly off the `description` field in `SKILL.md`'s frontmatter, surfaced automatically every session without any injection step. A SessionStart hook replicating the OpenCode bootstrap text would be redundant with what the skill description already does, and it isn't free — it means a shell script under `hooks/`, `hooks.json` wiring, and cross-platform behavior to keep working (this repo has no other executables and no CI coverage for one). Skipped for now: no benefit, real maintenance surface. Reconsider only if real usage shows the skill isn't self-triggering reliably enough on its own.

## Why not a separate `plugins/slopdocs/` subdirectory

Considered nesting the plugin under a subdirectory (`plugins/slopdocs/.claude-plugin/plugin.json`, marketplace `source: "./plugins/slopdocs"`) instead of using the repo root as the plugin. Rejected: it would need its own `skills/` pointing back at the top-level `skills/slopdocs/SKILL.md` via a relative path, and per the plugin manifest rules a component path can't escape the plugin's own root (`./../skills` is rejected as "path escapes plugin directory"). That would force either a second copy of `SKILL.md` or a symlink, both worse than reusing the existing root layout as-is via `source: "./"`.

## npm packaging

`.claude-plugin/` is intentionally absent from `package.json#files`. Claude Code installs this repo directly from GitHub through the plugin marketplace mechanism (`/plugin marketplace add ryanskidmore/slopdocs`), never through npm, so the manifests don't need to be in the published tarball. The OpenCode install path (npm, `main: ".opencode/plugins/slopdocs.js"`) is unaffected either way.
