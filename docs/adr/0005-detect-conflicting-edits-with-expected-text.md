# 5. Detect conflicting edits by sending the text the client saw

Date: 2026-07-26

## Status

Accepted

## Context

The todo file has several writers: the dashboard, the user in an editor, and an
agent with file tools. None of them coordinate.

The client refers to a task by `ordinal` — its position among tasks in the file.
Ordinals are not stable. If a task is deleted in an editor while a tab is open,
every ordinal after it shifts by one, and the tab's next click lands on the
wrong task. Silently ticking off the wrong todo is the worst failure this app
can have: it is invisible, and the user only finds out later.

## Decision

Make every mutation carry the text the client believed it was acting on.

- `toggle` and `delete` send `{ ordinal, expectedText }`.
- The server re-reads the file, resolves the ordinal, and compares the text.
  A mismatch — or an ordinal that no longer exists — returns **409**.
- On 409 the panel reloads from disk instead of retrying, and shows a banner.
- Writes are serialised through an in-process mutex and committed with a
  temp file plus `rename`, so a crash cannot leave a half-written file.

## Alternatives considered

- **Last write wins** — simplest, and exactly the silent wrong-task failure
  described above.
- **Stable UUIDs written into the file** — robust, and rejected on
  [0001](0001-todos-in-a-markdown-file-outside-the-repo.md) grounds: it litters a
  hand-edited file with machine identifiers, and the user would have to preserve
  them when editing by hand.
- **ETag or mtime over the whole file** — rejects any concurrent edit, including
  edits to an unrelated task or to surrounding prose. Far more false conflicts
  for no extra safety on the case that matters.
- **File locking** — does not help, since editors and agents will not take the
  lock.

## Consequences

Good:

- The wrong line cannot be edited. The failure mode becomes a visible, recover­
  able error instead of silent corruption.
- No machine identifiers in the user's markdown.
- Unrelated concurrent edits — different task, or prose — are accepted.

Bad:

- A genuine conflict surfaces to the user as an error they must retry.
- The mutex is per-process. Two server instances pointed at one file could still
  interleave; the temp-plus-rename commit keeps the file valid but a lost update
  is possible.
- Editing a task's *text* on disk while the dashboard is open will make that
  task's next dashboard action fail, even though nothing is actually wrong.
  Refreshing fixes it. This is the accepted cost of using text as the check.
- The dashboard does not watch the file, so it can hold a stale view until
  refreshed. A file watcher pushing updates would reduce how often 409s happen.
