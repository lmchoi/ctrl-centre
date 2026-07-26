# 2. Parse the todo file line by line rather than through a markdown AST

Date: 2026-07-26

## Status

Accepted

## Context

The todo file is hand-editable ([0001](0001-todos-in-a-markdown-file-outside-the-repo.md)),
so it will contain content the app knows nothing about: headings, prose, notes,
nested lists, links, whatever the user finds useful. All of it matters to the
user, and none of it is ours to normalise.

The obvious implementation is the standard markdown toolchain — parse with
remark/unified, mutate the AST, write back with `remark-stringify`.

## Decision

Do not round-trip through an AST. Instead:

- Scan the file as an array of lines and index only checklist lines
  (`- [ ]` / `- [x]`), recording each one's line number.
- Mutate by rewriting or splicing *those specific lines*. Every other line is
  passed through untouched.
- Track HTML comment and fenced-code-block state while scanning, and skip
  checklist lines inside them — those are documentation, not tasks.

## Alternatives considered

- **remark / unified + `remark-stringify`** — the idiomatic choice, and a trap
  here. `remark-stringify` re-serialises the *whole document*, normalising
  bullet characters, indentation, emphasis markers and blank lines. A user who
  wrote `* [ ]` and two blank lines would get `- [ ]` and one back. That
  silently destroys the property this whole design rests on.
- **remark for positions, then splice the original string** — safe, and
  essentially what we do, but it buys a full markdown parser's worth of
  dependency to locate lines a regex already finds reliably.
- **Regex over the whole document** — no way to track comment/fence state, so
  documented examples would parse as real tasks.

## Consequences

Good:

- The user's formatting survives byte for byte. Only touched lines change.
- The file can carry its own format spec at the top, with `- [ ]` examples
  inside a comment, without those examples becoming tasks.
- No dependency, and the logic is small enough to test exhaustively.

Bad:

- We implement checklist parsing ourselves, including comment and fence state
  tracking. That is real logic with real edge cases.
- It is not a markdown parser. Constructs we don't model — a checklist inside a
  blockquote, or inside a raw HTML block — will be read as ordinary tasks.
- The `ordinal` ↔ `lineNo` mapping has to be rebuilt after every write, and is
  only valid for the file as it was read.
