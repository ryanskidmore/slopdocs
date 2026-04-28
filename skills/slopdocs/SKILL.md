---
name: slopdocs
description: Use when writing, updating, or deciding whether to create documentation for features, bugs, or implementation plans. Follows the slopdocs convention for preserving agent-generated context in the repo.
---

# slopdocs

Your planning docs, bug investigations, and feature write-ups are the most valuable artifacts you produce. The code is the cheap part. Without these docs, the next agent starts from zero and re-derives the same constraints and re-litigates the same trade-offs every time.

This skill defines the slopdocs convention. Follow it whenever you create or update documentation in this project.

## The convention

Documentation lives in `slopdocs/` at the project root with three subdirectories:

```
slopdocs/
├── features/
│   └── <feature>.md
├── bugs/
│   └── YYYYMMDD-<short-slug>.md
└── plans/
    └── YYYYMMDD-<feature>.md
```

### `slopdocs/features/<feature>.md`

One living doc per feature. Describes how the feature works today: data models, key logic, design decisions. Update it when the feature changes.

### `slopdocs/bugs/YYYYMMDD-<short-slug>.md`

One file per bug investigation, date-prefixed. The fix lives in the commit history. The doc preserves the context: the rabbit holes, the red herrings, the root cause analysis. That context is what saves the next agent from repeating the same investigation.

### `slopdocs/plans/YYYYMMDD-<feature>.md`

One file per planning session, date-prefixed. Write the plan before writing code. Keep it after shipping. Reading the original plan is the fastest way to understand a feature later.

Features get one living document. Bugs and plans are point-in-time snapshots. The date prefix keeps things chronological and prevents naming collisions.

## When to write a slopdoc

- You spent significant time thinking about it, or there was a genuine architectural fork in the road.
- A bug had a non-obvious root cause that someone will probably hit again.
- You're building a new feature. Save the plan you already generated.
- A decision is going to look weird in three months and someone will be tempted to "refactor" it away.

## When to skip

- The diff is the documentation. Renames, reformats, dependency bumps.
- The change is trivial and easy to revert.
- Writing the doc would take longer than writing the code.
- You'd be repeating something already in another slopdoc. Link to it instead.

## How to write one

These are notes from one engineer to another. Keep it dense. State the decision first, then the reasoning. Document the alternatives you tried and why they failed. A messy list of bullet points is fine. Accurate and ugly beats polished and outdated.

Do not write status updates or summaries for humans to skim. Write context that the next agent can read and act on immediately.

## Before making changes

Read the relevant slopdocs before modifying any feature with existing documentation. Check `slopdocs/features/` for living docs and `slopdocs/plans/` for historical context on the area you're working in.

## Conflicts with other skills

Some skills save plans to their own paths (e.g. `docs/plans/`, `.sisyphus/plans/`). The slopdocs paths above take precedence: use the other skill to generate the content, then save it under `slopdocs/` with the filename conventions described here.
