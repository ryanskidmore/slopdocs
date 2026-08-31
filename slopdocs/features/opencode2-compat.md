# OpenCode 1 / OpenCode 2 plugin compatibility

`.opencode/plugins/slopdocs.js` has to load under two unrelated plugin
runtimes at once: OpenCode 1.x (the `opencode` binary, published as
`opencode-ai` / `@opencode-ai/cli`) and OpenCode 2 (`opencode2`, installed
via `@opencode-ai/cli@beta`, still in beta as of 2026-08-31). This doc is
the research trail behind the current shape and the traps to avoid when
touching it again.

## Where this was verified

Docs (`opencode.ai/docs`, `opencode.ai/v2/docs`) undersell how different the
v2 plugin API is and don't cover the exact loader mechanics. What's in
`slopdocs.js` was cross-checked against the actual loader source in
https://github.com/anomalyco/opencode (the org moved from `sst/opencode`,
which now redirects there; default branch is `dev`, not `main`) plus the
`@opencode-ai/plugin` package as published to npm under the `latest`,
`beta`, and `next` dist-tags (`npm pack @opencode-ai/plugin@<tag>` and read
the `.d.ts`/`.js` directly — the type packages and the actual runtime host
wiring disagree with each other in places; see "Known gap" below).

Key files read directly (paths from the `dev` branch):

- `packages/opencode/src/plugin/shared.ts` (`readV1Plugin`) and
  `packages/opencode/src/plugin/index.ts` (`applyPlugin`,
  `getLegacyPlugins`) — the v1 (current `opencode`) loader.
- `packages/core/src/config/plugin/external.ts` — the v2 (`opencode2`)
  loader.
- `packages/core/src/plugin/host.ts` and `packages/core/src/plugin/promise.ts`
  (`PluginHost.make`, `PluginPromise.fromPromise`) — what actually builds
  the `ctx` object handed to a v2 plugin's `setup()`.
- `packages/plugin/src/v2/{promise,effect}/*.ts` — the source the `@opencode-ai/plugin`
  package's `v2/promise` and `v2/effect` subpaths are built from (this is the
  API surface `packages/core` actually wires up — see "Known gap").
- `packages/sdk/js/src/v2/gen/types.gen.ts` — exact wire shapes
  (`SkillV2DirectorySource`, `Message`/`ContentPart`, etc.).

## The loaders are incompatible by design, not by accident

**v1 (`packages/opencode/src/plugin/shared.ts#readV1Plugin`, called in
"detect" mode from `applyPlugin`):**

1. Looks at `mod.default`. If it's a record containing `id`, `server`, or
   `tui`, it commits to treating the WHOLE plugin as that single
   default-exported object: calls `resolvePluginId(...)` and then
   `default.server(input, options)` (must return `Promise<Hooks>`). It does
   **not** fall back to scanning named exports once it commits, and if
   `default` has `id` but no `server`/`tui`, `readV1Plugin` throws — the
   whole plugin load fails, not just the default-export path.
2. Only if `mod.default` is absent (or not a record) does it fall back to
   `getLegacyPlugins(mod)`, which scans every named export
   (`Object.values(mod)`) for a bare function and calls each as
   `server(input, options)`. This is the shape the old `slopdocs.js` used
   (`export const SlopdocsPlugin = async () => {...}`, no default export).

**v2 (`packages/core/src/config/plugin/external.ts`):**

Dynamically imports the module and schema-validates `mod.default` as
`{ id: string, effect: fn }` (Effect-style) or `{ id: string, setup: fn }`
(Promise-style). There is no named-export fallback at all — a v1-style
plugin with no `default` export is invisible to it, matching the migration
doc at `opencode.ai/v2/docs/migrate-v1/` ("V1 plugins will not work in
V2... plugin implementation code must be ported to the new API").

**The consequence:** you cannot ship a v1-style named-export hooks-object
plugin *and* have v2 see it. You also cannot ship a `default` export with
just `{ id, setup }` and expect v1 to ignore it and fall back to legacy
scanning — v1 will find `id` in `default`, decide it's looking at a v1-style
default export, find no `server`, and throw, killing the whole plugin (both
jobs) under v1.

**The fix:** one `default` export carrying both `server` and `setup` on the
same object: `{ id: "slopdocs", server: v1Server, setup: v2Setup }`. v1's
`readV1Plugin` only inspects `id`/`server`/`tui` — the extra `setup` key is
inert to it. v2's schema union only requires `setup` to exist and be a
function — the extra `server` key is inert to it (Effect's `Schema.Struct`
default-ignores excess properties). Verified both branches in a throwaway
harness (not committed) that mimicked `readV1Plugin`'s field checks and
`PluginPromise.fromPromise`'s `ctx.skill`/`ctx.session` wiring.

## v2 API shape (Promise flavor, `setup(ctx)`)

v2 plugins don't return a hooks object; `setup(ctx)` runs once and
registers behavior imperatively against domain-scoped APIs
(`ctx.<domain>.transform(callback)` for stateful config-like domains,
`ctx.session.hook(name, callback)` for live interception). `ctx.skill` and
`ctx.session` are the two domains this plugin needs.

### Job 1: skill registration — `ctx.skill.transform`

v1 did this via the `config` hook: `config.skills.paths.push(skillsDir)`.
v2 has no generic `config` hook; skills are their own domain with a
transform-and-draft pattern:

```js
await ctx.skill.transform((draft) => {
  draft.source({ type: "directory", path: skillsDir });
});
```

`draft.source()`/`draft.list()` come from
`packages/plugin/src/v2/effect/skill.ts`
(`SkillDraft = { source(source: SkillV2Source): void; list(): readonly SkillV2Source[] }`).
`SkillV2Source` is a tagged union
(`packages/sdk/js/src/v2/gen/types.gen.ts`):
`{type:"directory", path}` | `{type:"url", url}` | `{type:"embedded", skill}`.
This is fully wired end to end in `packages/core/src/plugin/host.ts` →
`packages/core/src/plugin/skill.ts`, confirmed live in the `dev` branch.

**Trap:** the `@opencode-ai/plugin` package published to npm under the
`beta`/`next` dist-tags declares a *different*, richer `SkillDraft`
(`{ list(), add(skill), update(id, fn), remove(id) }` — CRUD over resolved
skills, no `source()`/no directory/url/embedded union). That's not what
`packages/core` actually implements as of this writing — it's either an
older or a not-yet-released shape. Don't trust the published `.d.ts` over
the `dev` branch source for this domain; they've drifted.

### Job 2: bootstrap injection — `ctx.session.hook("context", ...)`

v1 did this via `experimental.chat.messages.transform(input, output)`,
mutating `output.messages` in place. The closest v2 analog per the
published `@opencode-ai/plugin@beta`/`@next` types is a `session` domain
with a `hook(name, callback)` registration API and a `"context"` hook whose
event includes `messages: Array<Message>` (mutated in place, not returned —
none of its fields are `readonly` in the `.d.ts`, unlike the other session
hook events). `Message` shape
(`packages/llm/src/schema/messages.ts`): `{ role, content: ContentPart[], ... }`;
`ContentPart` includes `TextPart = { type: "text", text, ... }`. So:

```js
await ctx.session.hook("context", (event) => {
  const firstUser = event.messages.find((m) => m.role === "user");
  // ...same "already has the token" idempotency check as v1, then:
  firstUser.content.unshift({ type: "text", text: BOOTSTRAP });
});
```

**Known gap — this is NOT confirmed wired up yet.** Unlike `ctx.skill`,
there is no `SessionDomain`/`session` anywhere in
`packages/core/src/plugin/host.ts` (or anywhere else in the `dev` branch —
searched the whole repo). The `session` domain, `ctx.session.hook`, and the
whole `SessionHooks` interface (`prompt`, `context`, `model.request`,
`http.request`, `http.response`, `retry`) exist only in the npm-published
`@opencode-ai/plugin@beta`/`@next` `.d.ts` files, not in any runtime code
this repo could find in the public monorepo. Either it's implemented in a
branch that isn't public, or the type package is ahead of the shipped
runtime. Given "plugin APIs may change" is the beta's own official
caveat (`opencode.ai/v2/docs/`), this is treated as unstable-but-likely:
`v2Setup` feature-detects `ctx.session` and wraps `ctx.session.hook(...)`
in try/catch. If it's missing or throws, skill registration (job 1) still
succeeds and the plugin still loads cleanly under v2 — the bootstrap just
doesn't get injected until that hook lands. No user-visible error either
way; this was a deliberate choice over letting an unwired hook take the
whole plugin down.

## Other things checked and ruled out

- **Config field rename:** v1's `opencode.json` uses `"plugin": [...]`; v2
  renamed it to `"plugins": [...]` (confirmed both in
  `opencode.ai/v2/docs/migrate-v1/` and in
  `packages/opencode/src/config/v2-compat.ts`, which lowers v2 config to v1
  and explicitly flags `plugins` as unsupported-in-v1). README's install
  section now documents both. The rename doesn't touch `slopdocs.js` itself
  — only what users write in their own config.
- **Plugin discovery from `.opencode/plugins/`:** both loaders scan this
  directory automatically (v1 implicitly via the same directory-glob
  pattern class of logic; v2 explicitly via
  `fs.glob("{plugin,plugins}/*.{ts,js}", {cwd: entry.path, ...})` in
  `external.ts`). No config entry is required for in-repo dogfooding or for
  a project that vendors this repo directly into `.opencode/plugins/`. For
  the npm-distributed `slopdocs` package, the `id: "slopdocs"` default
  export field matters here too: v1's `resolvePluginId` requires a
  file-sourced plugin (any plugin picked up via directory-glob rather than
  an explicit `plugin`/`plugins` config entry) to declare its own `id`, or
  it throws — this is why `id: "slopdocs"` is on the shared default export
  rather than left out.
- **`.agents/skills/` manual-install path also works on v2 for free:**
  v2 auto-discovers `.agents/skills` (and `.claude/skills`,
  `.opencode/skills` searched upward, `~/.config/opencode/skills`) with no
  plugin or config needed. README's existing "Manual install" section
  (copy `SKILL.md` into `.agents/skills/slopdocs/SKILL.md`) already
  produces this layout, so it was left alone — it's accurate for v2 as-is.
- **npm plugin resolution:** unaffected. Both loaders resolve a bare
  package name like `"slopdocs"` through their own npm-install-on-demand
  step and then Node's normal `main`/`exports` resolution against the
  installed package; this repo's `package.json` (`main`, no `exports`
  field) needs no changes for either loader to find `.opencode/plugins/slopdocs.js`.

## Verification performed

- `node --check .opencode/plugins/slopdocs.js`.
- A throwaway harness (not committed) importing the real file and: (a)
  calling `default.server(input, options)` and driving the returned hooks
  exactly as `applyPlugin`/`Plugin.trigger` would (config hook idempotency,
  messages-transform idempotency, empty-session and no-user-message edge
  cases); (b) calling `default.setup(ctx)` against a fake `ctx` that mimics
  `packages/core/src/plugin/host.ts`'s `skill.transform`/`session.hook`
  wiring, including the no-`session`-domain case and a `session.hook` that
  throws, to confirm `setup()` never throws and skill registration always
  succeeds regardless of session-hook availability; (c) structural checks
  mirroring `readV1Plugin`'s field-presence logic and `external.ts`'s
  `PluginModule` schema union, so both loaders' actual acceptance criteria
  are exercised, not just "the function ran without crashing."
