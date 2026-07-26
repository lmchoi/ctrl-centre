# 4. Type with JSDoc and `checkJs`, not TypeScript syntax

Date: 2026-07-26

## Status

Accepted

## Context

One shape crosses a boundary nothing enforces. A task is produced by `toWire()`
in `server/todos.js`, serialised to JSON, and consumed by `renderRow()` in
`public/panels/todo.js`. Rename a field on one side and only a click at runtime
reveals it. The panel contract has the same weakness: it is described in prose
in `CLAUDE.md`, so a panel written months from now will drift from it.

Two facts shaped the decision, both verified on Node 26 rather than assumed:

1. Node runs `.ts` files directly, with no build step — type stripping is
   built in.
2. Node does **not** type-check them. Stripping is erasure. A file with
   `const t: Task = { text: 1, done: "no" }` executes without complaint.

So type *checking* requires `tsc` regardless of syntax, which means a
development dependency either way. Meanwhile browsers cannot load `.ts` at all,
so typing the client with TypeScript syntax would require a transpile step and
end [0003](0003-no-runtime-dependencies-no-build-step.md).

## Decision

Keep every source file as `.js` and annotate with JSDoc. Check with
`tsc --noEmit` via `npm run typecheck`.

- Cross-boundary types (`Task`, `Panel`) live in `types.d.ts` and are imported
  into JSDoc on both sides.
- `typescript` and `@types/node` are `devDependencies` only.
- Separate configs for server and client so server code cannot reach for
  `document`, and client code cannot reach for `process`.

## Alternatives considered

- **Full TypeScript** — strictest checking and best editor support. The server
  half is nearly free thanks to native stripping, but the client half needs
  esbuild or similar, which ends the no-build property for the whole project.
- **No types at all** — keeps the dependency count at zero, and leans entirely
  on tests. Rejected: tests catch the drift late and only where covered, while
  the editor catches it as you type.

## Consequences

Good:

- Checking exactly at the seam that needs it, with no build step and no change
  to how the browser loads anything.
- The conversion to real TypeScript is mechanical if a bundler ever arrives for
  other reasons.

Bad:

- `node_modules` now exists. It is development-only, but "zero dependencies" is
  no longer literally true.
- JSDoc is more verbose than TypeScript syntax, especially for generics.
- Checking is opt-in: it runs in the editor and in `npm run typecheck`, not at
  runtime. Nothing stops a contributor ignoring it without CI enforcing it.
