# OpenCode 1 / OpenCode 2 plugin compatibility

`.opencode/plugins/slopdocs.js` has to load under two unrelated plugin
runtimes at once: OpenCode 1.x (the `opencode` binary, published as
`opencode-ai` / `@opencode-ai/cli`) and OpenCode 2 (`opencode2`, installed
via `@opencode-ai/cli@beta`, still in beta as of 2026-09-06). This doc is
the research trail behind the current shape and the traps to avoid when
touching it again.

## History

- 2026-08-31: first dual-runtime version. The v2 half was written against
  the `anomalyco/opencode` `dev` branch of that day, whose skill domain
  exposed a draft with `source({ type: "directory", path })`.
- 2026-09-06: that draft shape is gone. `opencode2` builds from the npm
  `beta` dist-tag (`0.0.0-beta-19192`) expose a skill *editor*
  (`list/get/add/update/remove`) instead. Calling `draft.source(...)` threw
  `TypeError: draft.source is not a function` inside the transform, which
  marks the whole slopdocs plugin as failed at startup (see "What a
  throwing transform does" below). Rewritten to the editor API, following
  the official dual-support guide at
  <https://opencode.ai/v2/docs/build/plugins/#support-v1>.

## Where this was verified

The v2 docs (<https://opencode.ai/v2/docs/build/plugins/>) are now accurate
for the skill and session APIs, but they don't show validation or failure
mechanics. Everything below was cross-checked against the *shipped*
runtime, not the repo: `npm pack @opencode-ai/{plugin,schema,core}@beta`
(all `0.0.0-beta-19192`) and reading the bundled `dist/`. The core bundle
is chunked, but each chunk keeps a `// src/<file>.ts` marker, so the
references below name the original source file.

- `@opencode-ai/core` `src/plugin/module.ts` — the v2 loader: `Module`
  schema and the `effect`-vs-`setup` branch.
- `@opencode-ai/plugin` `dist/host.js` — `Host.resolve`, which picks the
  npm package entrypoint.
- `@opencode-ai/core` `src/plugin/host.ts` — builds the `ctx` handed to
  `setup()`; wraps `editor.add` in a schema decode.
- `@opencode-ai/core` `src/skill.ts` — the skill editor implementation.
- `@opencode-ai/core` `src/state.ts` — transform replay and failure
  handling (`create()`, `group()`, `disable()`).
- `@opencode-ai/core` `src/config/plugin/skill.ts` and
  `src/config/plugin/skill-file.ts` — how OpenCode 2 itself turns a
  `SKILL.md` on disk into a skill entry (what we imitate).
- `@opencode-ai/core` `src/session/...` (`SessionModelRequest.prepare`) —
  the `"context"` session hook trigger.
- `@opencode-ai/schema` `dist/skill.js` — `Skill.Info`; used directly in
  the verification harness.
- `@opencode-ai/plugin` `dist/promise/{skill,session,plugin,registration}.d.ts`
  — the published Promise-flavour types.

## The loaders are incompatible by design, not by accident

**v1 (`opencode`, `readV1Plugin` in `packages/opencode/src/plugin/shared.ts`):**
looks at `mod.default`. If it's a record containing `id`, `server`, or
`tui`, it commits to that object and calls `default.server(input, options)`
(must return `Promise<Hooks>`). It does not fall back to scanning named
exports once it commits, and if `default` has `id` but no `server`/`tui` it
throws. Per the v2 docs, this object form is supported from OpenCode
1.18.29; older v1 releases only understand bare exported functions.

**v2 (`opencode2`, `src/plugin/module.ts`):** dynamically imports the
module and decodes it with

```ts
Schema.Struct({ default: Schema.Union([
  Schema.Struct({ id: Schema.String, effect: <function> }),
  Schema.Struct({ id: Schema.String, setup:  <function> }),
])})
```

then `"effect" in value ? value : fromPromise(value)`. There is no
named-export fallback. Excess keys are ignored by the decode, so `server`
sitting next to `setup` is inert. **Trap:** never add an `effect` key to
the default export for any reason — the `in` check would route the plugin
down the Effect path and skip `setup` entirely.

**The shape:** one `default` export carrying both,
`{ id: "slopdocs", server: v1Server, setup: v2Setup }`. This is exactly
the pattern the v2 docs prescribe under "Support V1" (they spread
`Plugin.define({...})` for typing; we don't depend on
`@opencode-ai/plugin`, so a plain object does the same job).

**npm entrypoint (v2):** `Host.resolve` tries `<pkg>/server` then `<pkg>`
via normal module resolution, so `package.json#main` pointing at
`.opencode/plugins/slopdocs.js` is picked up without an `exports` map.
Unchanged from v1.

## v2 job 1: skill registration — `ctx.skill.transform` + `editor.add`

v1 did this via the `config` hook (`config.skills.paths.push(skillsDir)`).
v2 has no config hook and no "directory source" API for plugins any more;
plugins add resolved skills:

```js
await ctx.skill.transform((editor) => {
  editor.add({ id, name, description, location, content });
});
```

What the host does with that (`src/plugin/host.ts`):

```js
add: (value) => editor.add(Schema.decodeUnknownSync(Skill.Info)(value))
```

`Skill.Info` (`@opencode-ai/schema`) is
`{ id, name, description?, slash?, autoinvoke?, location, content }`.
Verified against the real schema in the harness:

- `id`, `name`, `location`, `content` are required strings.
- `description` must be a string **or the key must be absent**. An
  explicit `description: undefined` is rejected with "Expected string".
  That's why `loadSkills()` spreads the key in conditionally.
- Extra keys are stripped, not rejected.
- `location` is branded `AbsolutePath` but the brand isn't checked at
  runtime. It still has to be the absolute path of the `SKILL.md`:
  `Skill.prepare` does `path.dirname(skill.location)` and lists the sibling
  files of that directory when the `skill` tool loads it, and reports it
  to the model as the skill's base directory.

The editor itself (`src/skill.ts`) is a `Map` keyed by id;
`add` is `Map.set` (last writer wins), `list()` returns the current
entries, `get(id)` a single one.

**What the fields should contain** — mirror `src/config/plugin/skill-file.ts`,
which is how OpenCode 2 loads a `SKILL.md` from `.opencode/skills/` etc.:

- `id` = the skill's directory name (`slopdocs`).
- `name` = frontmatter `name`, falling back to `id`.
- `description` = frontmatter `description`.
- `location` = absolute path of the `SKILL.md`.
- `content` = the markdown body *after* the frontmatter (gray-matter's
  `.content`). The full file with frontmatter would also "work" but would
  put the YAML block in the model's context.

OpenCode uses gray-matter for this; `slopdocs.js` uses a ~15-line regex
reader instead of adding a dependency. That is fine only because
`SKILL.md`'s frontmatter is flat `key: value` lines. The harness compares
the reader's output to gray-matter's on the real file.

**Ordering / not overriding a local copy:** `ConfigSkillPlugin`
(`src/config/plugin/skill.ts`) adds every skill it discovers on disk
(`.opencode/skill{,s}`, `.claude/skills`, `.agents/skills`, plus
`opencode.json` `skills: [...]` entries — directories or URLs) through the
same `editor.add`. Our transform skips any id already in `editor.list()`,
so a project that has both the plugin and a manually copied
`.opencode/skills/slopdocs/SKILL.md` keeps the local copy regardless of
which transform runs first.

**Transforms are synchronous and replayed.** `State.create()`
(`src/state.ts`) re-runs every registered transform from a fresh
`initial()` whenever the state is dirty (any registration, any
`ctx.skill.reload()`, any config change). So the callback must be pure and
fast; `slopdocs.js` reads the files once in `setup()` before registering.
Consequence: edits to `SKILL.md` need an `opencode2` restart to show up
under the plugin (under v1's directory source they were picked up live).

**Pre-release fallback:** if the editor has no `add` but has `source`,
`slopdocs.js` still calls `source({ type: "directory", path })` so an
opencode2 build from before 2026-09 keeps working. Delete that branch once
those builds are gone; it's the only reason the transform inspects the
editor's shape.

### What a throwing transform does

`State.create().get()` wraps each transform in `try/catch`. On a throw it
calls `disable(group, failure)` for the plugin's registration group: every
registration the plugin made is removed and the failure is reported, and
`Plugin.activate` logs `failed to load plugin` with the plugin id and marks
it failed. So a single bad call inside the transform — the old
`draft.source(...)` — takes down both jobs and surfaces as a broken
plugin, which is what happened on 2026-09-06.

## v2 job 2: bootstrap injection — `ctx.session.hook("context", ...)`

v1 did this via `experimental.chat.messages.transform`, prepending a text
part to the first user message. The 2026-08-31 write-up flagged the v2
session hooks as "declared in types, not found in runtime". That's no
longer true: `SessionModelRequest.prepare` runs
`hooks.trigger("session", "context", context)` on every model call, with

```ts
{ sessionID, agent, model, system: SystemPart[], messages: Message[],
  tools, generation, providerOptions }
```

and then passes `context.system` / `context.messages` straight into
`LLM.request`. So `slopdocs.js` now does what the docs' "Model context"
section shows:

```js
await ctx.session.hook("context", (event) => {
  if (event.system.some((part) => hasBootstrap(part.text))) return;
  event.system.push({ type: "text", text: BOOTSTRAP });
});
```

Why the system prompt rather than the first user message:

- It's the documented v2 way to add standing instructions.
- Neither is persisted: "Context changes affect only the outgoing model
  call, not persisted history". The event is rebuilt from the transcript
  on every call, so pushing once per call doesn't stack. The token check
  stays as belt-and-braces (another plugin/agent could add it).
- Appending a fixed block at the end of `system` is prompt-cache friendly.

Shape: built-in plugins push `SystemPart.make(text)`, which is
`{ type: "text", text }`. The docs' example omits `type`; include it —
`SystemPart` is a struct with `type: Literal("text")`.

The hook runs for compaction requests too (harmless) and not for title
generation. `ctx.session` is still feature-detected so an unexpected build
can't break skill registration.

## Other things checked and ruled out

- **Config field rename:** v1's `opencode.json` uses `"plugin": [...]`; v2
  uses `"plugins": [...]`. README documents both. Doesn't affect
  `slopdocs.js`.
- **v2 `skills` config:** v2 also accepts `skills: ["<dir or URL>", ...]`
  in `opencode.json` and auto-discovers `.opencode/skill{,s}`,
  `.claude/skills` and `.agents/skills`. README's "Manual install" path
  therefore works on v2 with no plugin. Not a replacement for the plugin
  though: the npm package is installed into OpenCode's own cache, not a
  path a user would put in config, and only the plugin injects the
  bootstrap.
- **`@opencode-ai/plugin` as a dependency:** not needed. `Plugin.define`
  is an identity function for typing; the loader only checks the shape.
- **Plugin discovery from `.opencode/plugins/`:** unchanged; both runtimes
  scan `.opencode/plugin{,s}/*.{js,ts}`. `id: "slopdocs"` stays on the
  default export because v1 requires file-sourced plugins to declare one.

## Verification performed (2026-09-06)

- `node --check .opencode/plugins/slopdocs.js`.
- A throwaway harness (scratch, not committed) that imports the real
  file and:
  - decodes the module with a copy of the v2 `Module` schema (Effect 4
    rc.112, same as the beta) and asserts the `setup` branch is taken;
  - checks the v1 `id`+`server` field test, then drives the v1 hooks
    (config idempotency, message-transform idempotency, empty session,
    no user message);
  - runs `setup()` against a host mimic whose `editor.add` decodes with
    the **real** `Skill.Info` from `@opencode-ai/schema@beta`, and whose
    transforms are replayed the way `State.create()` does; asserts the
    registered entry's `id/name/description/location/content` equal what
    gray-matter (the parser OpenCode 2 uses) yields for
    `skills/slopdocs/SKILL.md`;
  - asserts a same-id skill added by an earlier transform is left alone;
  - exercises the pre-release `source()` fallback, a `ctx` with no
    `session`, an editor with neither `add` nor `source`, and an empty
    `ctx`;
  - fires the `context` hook twice on one event and checks exactly one
    `{ type: "text", text }` part is appended and `messages` is untouched.
- Not verified: an end-to-end run under a real `opencode2` (not installed
  on the machine used). The mimic follows the shipped host code line by
  line, but the first real session after upgrading should still confirm
  the skill appears in the skills list and the bootstrap shows up once.
