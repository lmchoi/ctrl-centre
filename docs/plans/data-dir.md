# Plan: a data directory instead of a todo file path

## Goal

`CTRL_CENTRE_DIR` names one directory outside the repo (default
`~/.ctrl-centre`) that holds every personal data file the dashboard owns;
`config.todoFile` is derived as `<dir>/todos.md`.

## Out of scope

- `journal.md` itself, and anything journal-shaped — that is the next slice.
  This slice only makes room for it.
- Migrating an existing file. `CTRL_CENTRE_TODO_FILE` is unset in the user's
  environment and in every shell rc, and `~/.ctrl-centre/todos.md` already sits
  at the default location, so there is nothing to move and no compatibility
  shim to write.
- Broadening the `.gitignore` safety net beyond `todos.md`. Revisit when a
  second data file exists.
- A `dir:path` npm script. `npm run todo:path` still resolves correctly and is
  what CLAUDE.md documents.

## Design

**Clean break, no fallback.** `CTRL_CENTRE_TODO_FILE` stops being read. Chosen
over honouring both because nothing sets it: a compatibility branch would be
untested-in-practice config code guarding an event that cannot happen here.

`server/config.js` grows a pure exported resolver:

```js
export function resolveDataDir(raw) { … }   // undefined/blank → default, ~ → home, else absolute
export const config = { dir, todoFile: path.join(dir, 'todos.md'), port, host };
```

Pure and exported specifically so it is testable: `config` is evaluated once at
import time, so a test that wanted to try several env values would otherwise
need cache-busting dynamic imports. The resolver takes the raw string, not the
env, so no test has to mutate `process.env`.

`displayPath()` is unchanged and now also gets used for the directory.

Files affected:

- `server/config.js` — resolver + `config.dir`, `config.todoFile` derived
- `server/index.js` — the startup log line becomes `data dir → …` (line ~176)
- `test/config.test.js` — new; the first tests this module has ever had
- `test/server.test.js` — line 14 sets `CTRL_CENTRE_DIR` instead (it already
  makes a temp *directory* and joins `todos.md`, so this is a one-line change)
- `docs/adr/0007-personal-data-in-a-directory.md` — new
- `docs/adr/README.md` — index row for 0007, and 0001's status annotated
- `README.md`, `CLAUDE.md` — the documented env var and the `echo` fallback

**ADR handling.** ADR 0001's Decision section states "Path resolves from
`CTRL_CENTRE_TODO_FILE`", so this change contradicts a recorded decision and
needs its own record. ADR 0007 supersedes *only that path rule* — storing
todos as markdown outside the repo, the first-run template, and the
`.gitignore` net all still stand. Because ADRs are immutable in this repo,
0001's own file is not edited; the index table carries the annotation.

## Commits

1. Resolve a data directory in `server/config.js` — test: new
   `test/config.test.js` covers default-when-unset, default-when-blank, `~`
   expansion, relative-to-absolute, and `todoFile` landing at `<dir>/todos.md`;
   `test/server.test.js` switches to `CTRL_CENTRE_DIR` and is red before the
   change, green after.
2. Record the directory decision as ADR 0007 and update the docs — test: none
   beyond `npm run check`; docs-only, verified by reading `npm run todo:path`
   output against what CLAUDE.md now tells an agent to run.

## Status

Both commits done. 59 tests pass (49 before, 10 new in `test/config.test.js`).

Deviations from the plan:

- Commit 1 also added a guard to `test/server.test.js` asserting the suite is
  pointed at its temp directory before the store is constructed, and CLAUDE.md
  gained a line telling future suites to keep it. Not in the original plan —
  added because the red step of this very slice wrote a task into the real
  `~/.ctrl-centre/todos.md`: the test set `CTRL_CENTRE_DIR` while `config.js`
  still read `CTRL_CENTRE_TODO_FILE`, so resolution fell back to the default
  path. No data was lost (the file held only its header) but the guard is the
  fix for the class of mistake, not just this instance.
- `server/todos.js` had a comment naming the old variable; updated in commit 2.

Verified:

- `npm run check` green with `HOME` pointed at an empty temp directory, and
  nothing created at the default location in that run — the suite no longer
  reaches the real data directory.
- `npm run todo:path` agrees with the `echo "${CTRL_CENTRE_DIR:-…}/todos.md"`
  fallback documented in CLAUDE.md, both with and without the var set.
