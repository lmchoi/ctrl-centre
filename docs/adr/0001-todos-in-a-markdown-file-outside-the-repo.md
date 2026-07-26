# 1. Todos live in a markdown file outside the repo

Date: 2026-07-26

## Status

Accepted

## Context

The dashboard's first panel is a personal todo list. This repo is version
controlled and may be shared or made public; personal todos must never end up in
its history. The brief was explicit: "i want a way to load my todos but i dont
want this to be stored in this repo".

Beyond that constraint, the data should outlive the app. A dashboard is a view
over todos, not their owner — the list should stay readable and editable if the
server is never started again.

## Decision

Store all todos in a single markdown file outside the repository.

- Path resolves from `CTRL_CENTRE_TODO_FILE`, defaulting to
  `~/.ctrl-centre/todos.md`.
- The file is created with a template on first run.
- `.gitignore` lists `todos.md` as a safety net against an accidental copy
  landing inside the repo.

## Alternatives considered

- **`localStorage`** — what the design prototype used. Rejected: the data dies
  with the browser profile, can't be edited outside the app, and can't be
  synced or backed up.
- **SQLite** — better for querying and future panels. Rejected for now: it makes
  the data opaque to every other tool the user owns, for a list that is
  fundamentally a handful of lines of text.
- **JSON alongside the repo** — rejected: not hand-editable in any pleasant way,
  and no better than markdown at anything here.

## Consequences

Good:

- The file is greppable, diffable, and editable in any editor, Obsidian, or by
  an agent with plain file tools.
- Syncing is the user's choice — Dropbox, iCloud, a private git repo — with no
  work from us.
- The data survives the app being deleted.

Bad:

- No schema and no migrations. A format change has to tolerate every file
  written by every previous version.
- No history unless the user versions the file themselves.
- The file can change underneath a running dashboard, which forces conflict
  detection — see [0005](0005-detect-conflicting-edits-with-expected-text.md).
- Multi-device use has no conflict resolution beyond whatever the user's sync
  tool does.
