# Architecture decision records

Short records of decisions that had real alternatives, in
[Michael Nygard's format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Each one states the context, what was decided, what else was considered, and
what it costs.

ADRs are immutable once accepted. If a decision changes, add a new record that
supersedes the old one rather than editing it — the point is the reasoning at
the time, including the parts that turned out wrong.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-todos-in-a-markdown-file-outside-the-repo.md) | Todos live in a markdown file outside the repo | Accepted — path rule superseded by [0007](0007-personal-data-in-a-directory.md) |
| [0002](0002-line-preserving-markdown-parser.md) | Parse the todo file line by line rather than through a markdown AST | Accepted |
| [0003](0003-no-runtime-dependencies-no-build-step.md) | No runtime dependencies and no build step | Accepted — rendering-layer consequence superseded by [0008](0008-shared-component-builders-not-a-framework.md) |
| [0004](0004-jsdoc-types-instead-of-typescript.md) | Type with JSDoc and `checkJs`, not TypeScript syntax | Accepted |
| [0005](0005-detect-conflicting-edits-with-expected-text.md) | Detect conflicting edits by sending the text the client saw | Accepted |
| [0006](0006-panel-registry.md) | Panels are self-contained modules in a registry | Accepted |
| [0007](0007-personal-data-in-a-directory.md) | Personal data lives in a directory, one markdown file per panel | Accepted |
| [0008](0008-shared-component-builders-not-a-framework.md) | Shared component builders, not a framework — yet | Accepted |

## Known triggers to revisit

Decisions here are deliberately provisional. The conditions that should prompt a
new ADR:

- ~~**A second panel starts duplicating card and row markup**~~ → fired when the
  journal panel landed; resolved by shared builders in
  [0008](0008-shared-component-builders-not-a-framework.md), not Preact.
- **A third panel needs the same mount lifecycle** (load / render / error / busy
  / 409-reload), **or any panel needs keyed list re-rendering** → ask the Preact
  question a third time, [0008](0008-shared-component-builders-not-a-framework.md).
- **A third markdown store appears** → extract the mutex and atomic-write
  machinery duplicated between `server/todos.js` and `server/journal.js`, but
  keep their write queues independent,
  [0008](0008-shared-component-builders-not-a-framework.md).
- **Panels need to be linkable or bookmarkable** → add a router,
  [0006](0006-panel-registry.md).
- **The API grows past a handful of routes, or gains auth** → reconsider the
  hand-rolled HTTP layer, [0003](0003-no-runtime-dependencies-no-build-step.md).
- **The dashboard is used from two machines at once** → the concurrency story in
  [0005](0005-detect-conflicting-edits-with-expected-text.md) is single-process
  and will not hold.
- **A bundler arrives for any reason** → the JSDoc-to-TypeScript conversion in
  [0004](0004-jsdoc-types-instead-of-typescript.md) becomes nearly free.
