# 3. No runtime dependencies and no build step

Date: 2026-07-26

## Status

Accepted

## Context

This is a personal tool that should still start years from now without an
afternoon of dependency archaeology. It is also small: the whole thing is
roughly 800 lines.

The conventional stack — Express or Hono on the server, Vite plus React on the
client — brings a `node_modules` tree, a build step between editing and running,
and a permanent upgrade obligation.

## Decision

Use Node's built-in `http` module and vanilla ES modules loaded directly by the
browser. Hand-roll what would otherwise be dependencies:

- static file serving, routing and body parsing (`server/index.js`)
- a small DOM helper, `el()` / `clear()` / `api()` (`public/lib/dom.js`)
- the panel registry ([0006](0006-panel-registry.md))

The design system ships as plain CSS custom properties and classes, not as
components.

`npm start` is the entire toolchain. Development-time dependencies are
acceptable where they never reach runtime — see
[0004](0004-jsdoc-types-instead-of-typescript.md).

## Alternatives considered

- **Express or Hono** — would delete the fiddliest parts of `server/index.js`:
  the path traversal guard, the MIME map and the body size limit. That is a
  genuine argument, since those are exactly where a hand-rolled server hides
  bugs. Judged not worth a dependency at three routes, having tested them.
- **Vite + React/Preact** — the ergonomics are better and the design source is
  already component-shaped. Rejected because it ends "clone it and run it".

## Consequences

Good:

- Clone, `npm start`, done. Nothing to install, nothing to compile.
- No supply chain surface and no upgrade treadmill.
- The browser loads the same files that are in the repo, so what you debug is
  what you wrote.

Bad:

- We own ~140 lines of HTTP handling, including security-sensitive path
  resolution. A framework would have that reviewed by thousands of people.
- Panels build DOM by hand, so design-system markup gets re-derived in every
  panel rather than expressed once as a component. The design source treats
  `Card` and `Button` as components; we flattened them to CSS classes.

This second point is the one to revisit. When a second panel starts copying card
and row markup, move to Preact + htm vendored as two local files — that restores
components while still requiring no build step. Not before: one panel does not
justify it.
