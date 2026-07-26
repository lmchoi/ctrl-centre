# 7. Personal data lives in a directory, one markdown file per panel

Date: 2026-07-26

## Status

Accepted

Supersedes the path-resolution rule in
[0001](0001-todos-in-a-markdown-file-outside-the-repo.md). Everything else in
0001 stands: personal data is still markdown, still outside the repo, still
created from a template on first run, still guarded by `.gitignore`.

## Context

[0001](0001-todos-in-a-markdown-file-outside-the-repo.md) resolved a single file
from `CTRL_CENTRE_TODO_FILE`, defaulting to `~/.ctrl-centre/todos.md`. That was
right for one panel.

A journal panel is next, and it needs its own file. With a per-file environment
variable, a second panel means a second variable — `CTRL_CENTRE_JOURNAL_FILE`,
then a third for whatever follows — each independently overridable, so nothing
guarantees they end up anywhere near each other. Someone who moves their data to
a synced folder would have to move each file separately and could silently move
only some.

The default already implied the answer: `~/.ctrl-centre/` was always a directory
containing `todos.md`. Only the config disagreed.

## Decision

One environment variable names a directory. Every file the dashboard owns lives
inside it.

- `CTRL_CENTRE_DIR`, defaulting to `~/.ctrl-centre`. `~` is expanded and
  relative paths are resolved to absolute.
- `config.dir` is the directory; per-file paths are derived from it
  (`config.todoFile` = `<dir>/todos.md`).
- `CTRL_CENTRE_TODO_FILE` is no longer read at all.

The resolver is exported as a pure function, `resolveDataDir(raw)`, so path
resolution is testable without mutating `process.env` — `config` is built once
at import time.

## Alternatives considered

- **Keep `CTRL_CENTRE_TODO_FILE` working as an override.** The safe-looking
  option, and rejected for that reason: it is a permanent branch in config
  guarding a case that does not exist. The variable is unset in the user's
  environment and absent from every shell rc, and `~/.ctrl-centre/todos.md` is
  already at the default path, so a clean break moves no data and breaks no
  setup. A compatibility shim nobody exercises is a shim nobody notices
  breaking.
- **One variable per file** (`CTRL_CENTRE_TODO_FILE`,
  `CTRL_CENTRE_JOURNAL_FILE`, …). Maximum flexibility, and nothing asked for it.
  It scales linearly with panels and permits incoherent states — todos synced,
  journal not — for no gain in a single-user tool.
- **A config file** (`~/.ctrl-centre/config.json`). More expressive than an env
  var, and the wrong direction for a tool whose entire configuration is a path
  and a port. It also raises the question of where the config file itself lives.

## Consequences

Good:

- Adding a panel with its own storage is a one-line derivation, not a new
  environment variable and a new docs paragraph.
- The whole dataset moves, syncs and backs up as one directory.
- `server/config.js` has tests for the first time, because the resolver is now
  a pure exported function rather than an inline closure over `process.env`.

Bad:

- A breaking config change, however cheap it is *here*. Any environment that
  did set `CTRL_CENTRE_TODO_FILE` silently reverts to the default path rather
  than failing — the failure mode is quiet, and quiet is the bad kind.
- The directory is now a shared namespace: two panels could collide on a
  filename. Nothing enforces uniqueness beyond the derivations being in one
  file.
- Panels cannot put their data in different places, if that ever turns out to
  matter.
