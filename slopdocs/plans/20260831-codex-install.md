# Codex install (2026-08-31)

Added `install/codex.sh`, a one-line installer for OpenAI Codex (CLI, IDE
extension, desktop app), plus a README "Install (Codex)" section. Decision
record for the next agent who touches this.

## What Codex actually supports (verified against source, not blog posts)

Confirmed against the live `openai/codex` GitHub repo source
(`codex-rs/ext/skills/src/host_roots.rs`, main branch, fetched 2026-08-31)
and the official docs (`https://developers.openai.com/codex/skills`, which
redirects to `https://learn.chatgpt.com/docs/build-skills`):

- Codex natively supports Anthropic-style `SKILL.md` skills (open
  `agentskills.io` standard). Frontmatter requirement is just `name` +
  `description` — identical to our canonical `skills/slopdocs/SKILL.md`.
  No format delta to handle.
- Skill discovery roots, per `resolve_skill_roots_with_home_dir` in
  `host_roots.rs`:
  - Repo scope: `<dir>/.agents/skills` for every directory from the repo
    root down to cwd, **and** `<project-config-folder>/skills` (i.e.
    `.codex/skills` next to a project `config.toml`, if one exists).
  - User scope: `~/.agents/skills` (current, not deprecated).
  - `$CODEX_HOME/skills` (`~/.codex/skills` by default) is explicitly
    commented `// Deprecated user skills location ... kept for backward
    compatibility` in that same source file. Do not target it.
  - Admin (`/etc/codex/skills`) and bundled system skills, not relevant
    here.
- Symlinked skill directories are followed when scanning.
- No `--enable skills` / feature flag is required for skills to work; they
  are on by default. (`config.toml`'s `[[skills.config]]` can *disable* a
  specific skill by path, but that's opt-out, not opt-in.)

Chose `.agents/skills` over `.codex/skills` as the install target because
it's the cross-tool, non-deprecated, officially documented convention (and
is what the README's pre-existing "Manual install" section already pointed
at for "cross-tool compatibility" — this was already the right call before
Codex support was added).

## Verified end-to-end, without credentials

`codex debug prompt-input` (bundled `@openai/codex` npm package, v0.151.0)
renders the model-visible prompt input as JSON without needing API auth.
Ran it against a temp `$HOME`/temp project with the unmodified
`skills/slopdocs/SKILL.md` dropped at both `./.agents/skills/slopdocs/` and
`$HOME/.agents/skills/slopdocs/`. Codex listed the skill correctly in both
cases with the exact `name`/`description` from our file, sourced from the
matching skill root (`r1` = repo `.agents/skills`, `r0` = user
`.agents/skills` in the respective runs). No transformation was needed.

## Why not a Codex "plugin" (the more "native" package mechanism)

`codex plugin marketplace add <source>` + `codex plugin add
name@marketplace` is a real, scriptable, non-interactive CLI mechanism
(confirmed via `codex-rs/cli/src/plugin_cmd.rs` and `marketplace_cmd.rs`,
and by running the actual installed CLI's `--help`). It was **not** used
here because it requires:
- A versioned `.codex-plugin/plugin.json` manifest (separate semver from
  `package.json`, required `author.name`, required `interface` block).
- A `marketplace.json` (personal `~/.agents/plugins/marketplace.json` or
  repo `<root>/.agents/plugins/marketplace.json`) with policy/category
  metadata.
- Two CLI invocations instead of one, and ongoing maintenance of a second
  packaging surface alongside the existing npm/OpenCode one.

That's real infrastructure investment for a repo whose `AGENTS.md`
explicitly says "no build, no tests, no lint... don't invent any without
asking." The plain `.agents/skills` file-drop route is equally "native"
(officially documented, not a workaround) and gets the same one-line
install UX. Revisit the plugin/marketplace route only if Codex's plugin
directory becomes a real discovery channel users search — until then it's
extra surface for no material benefit.

## Script design notes (`install/codex.sh`)

- POSIX `sh`, no bashisms (checked with `sh -n`, `bash -n`, `dash -n`).
- Default target: `./.agents/skills/slopdocs` (repo-scoped — matches the
  convention's whole premise of being a per-repo thing). `--global`/`--user`
  installs to `~/.agents/skills/slopdocs` instead.
- Dual source mode: if invoked from inside a slopdocs checkout (i.e.
  `$0`'s directory has a `../skills/slopdocs/SKILL.md` next to it), copies
  that file directly — no network needed, and local edits install as-is.
  Otherwise (the `curl | sh` case, where `$0` is just `sh`) fetches the
  raw file from `raw.githubusercontent.com/.../main/skills/slopdocs/SKILL.md`.
  Both paths were tested directly, including a real network fetch against
  the live repo.
- Overwrites on re-run (no "destination exists" abort like OpenAI's own
  `skill-installer` sample) — this is a single-file skill from one
  canonical source, so overwrite *is* the upgrade path, per the task's
  "idempotent and re-runnable for upgrades" requirement.

## What's untested

No smoke test of the real interactive Codex TUI/session (would need
credentials). `codex debug prompt-input` verifies discovery + prompt
rendering only, not that a live session actually invokes the skill on a
matching prompt.
