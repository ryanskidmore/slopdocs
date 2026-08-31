# AGENTS.md

Notes for agents working in this repo. The product is one skill; the OpenCode plugin and the Claude Code plugin marketplace exist only to make each tool discover it and (for OpenCode) remind the agent to load it.

## What this repo ships

- `skills/slopdocs/SKILL.md` — the skill. Canonical source of the convention. YAML frontmatter (`name`, `description`) drives discovery; do not break it.
- `.opencode/plugins/slopdocs.js` — OpenCode plugin. Two jobs: register `skills/` as a skill path (via the `config` hook) and prepend a short bootstrap pointer to the first user message of each session (via `experimental.chat.messages.transform`).
- `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` — make this repo a Claude Code plugin marketplace with itself as the (only) plugin, via `"source": "./"`. No bootstrap hook: Claude Code's plugin skills are model-invoked from the `description` in `SKILL.md`'s frontmatter automatically, so there's nothing to inject. Don't add a `skills` field to `plugin.json` — the default `skills/` scan already picks up `skills/slopdocs/SKILL.md` as-is; adding one only matters if this repo ever hosts more than one plugin entry sharing the marketplace root (see the plugin-marketplaces reference on "marketplace root plugins").
- `package.json` (root) — declares the package as the plugin entry: `main: ".opencode/plugins/slopdocs.js"`, `type: "module"` (ESM). The `files` array controls what npm publishes (`.opencode/plugins/slopdocs.js` and `skills/`); README and LICENSE are auto-included. `.claude-plugin/` is deliberately left out of `files` — Claude Code installs this repo straight from GitHub via the plugin marketplace mechanism, not from the npm tarball, so those manifests don't need to ship there.
- `README.md` — install instructions and a summary of the convention.
- `.github/workflows/publish.yml` — npm publish workflow. See "Publishing" below.

## Layout gotchas

- Path resolution in the plugin: `path.resolve(__dirname, "../../skills")` walks from `.opencode/plugins/` up to the repo root and into `skills/`. This works in dev *and* when the package is consumed as a git dependency (where the file lives at `node_modules/slopdocs/.opencode/plugins/slopdocs.js` and the same relative walk lands on `node_modules/slopdocs/skills`). Don't move `skills/` or `.opencode/plugins/` without updating that path.
- `.opencode/package.json` and `.opencode/node_modules/` are untracked on purpose — see `.opencode/.gitignore`. They exist locally so the `@opencode-ai/plugin` type package can be installed for development; they are not part of the distribution. Don't commit them.
- The bootstrap injection in `slopdocs.js` is gated by searching message parts for the literal token `slopdocs-skill`. If you change the bootstrap text, keep that token in it (and in the idempotency check), or every session will get a new copy stacked on top.

## Three places the convention appears

Only one is canonical:

1. `skills/slopdocs/SKILL.md` — canonical. Edit here.
2. `README.md` — human-facing summary. Update only if the convention itself changed.
3. `BOOTSTRAP` constant in `.opencode/plugins/slopdocs.js` — short pointer the agent sees first. It should not restate the skill, just point to it.

When the convention changes, update the skill first, then check whether 2 and 3 still describe it accurately.

## No build, no tests, no lint

There are no scripts in `package.json`, no test framework, no formatter config. Don't invent any without asking. Verification is manual: add the plugin to another repo's `opencode.json` and open a session to confirm the skill loads and the bootstrap appears once.

## Publishing

Distribution is via npm. `.github/workflows/publish.yml` publishes on GitHub Release `published` events using npm trusted publishing (OIDC); no `NPM_TOKEN` is configured. Provenance is automatic.

- The workflow filename `publish.yml` is baked into the npm trusted publisher config on npmjs.com. Renaming or moving the file silently breaks publishing. Update the npm config first if you need to rename.
- Node 24 is required (npm CLI 11.5.1+ is needed for OIDC). Don't downgrade.
- The package must already exist on npm before trusted publishing can be configured — there's no "pending publisher" feature. The first publish has to be done manually with a token; subsequent publishes go through CI.
- `package.json#files` controls what ships. If you add a new file the plugin needs at runtime, add it to `files` or it won't be in the published tarball.
- Release ritual: `npm version <patch|minor|major>`. The `postversion` script in `package.json` pushes the tag and runs `gh release create --generate-notes`, which fires the workflow. Requires `gh` to be installed and authenticated. To skip the auto-release (e.g. to hand-edit release notes first), run `npm --ignore-scripts version <bump>` and create the release yourself.

## Dogfooding

This repo follows its own convention. If you do work here that warrants a slopdoc (e.g. a non-obvious change to the bootstrap injection logic, a redesign of the skill), file it under `slopdocs/` per `skills/slopdocs/SKILL.md`. See `slopdocs/features/claude-code-marketplace.md` for an example — it documents the Claude Code plugin marketplace setup and the alternatives that were rejected.
