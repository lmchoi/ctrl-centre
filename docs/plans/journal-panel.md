# Plan: journal panel

## Goal

A `Journal` panel that writes timestamped entries to `<dir>/journal.md` — write
an entry, see entries newest-first, delete one — matching the Journal card in the
design source, minus tags.

## Design source

Claude Design project `Todo list dashboard design`, file `Todo Dashboard.dc.html`
(project id `b3e2f445-19c0-4227-98c5-5cd69dceac77`), readable with the
`DesignSync` tool's `get_file` method. There is no copy in the repo. The Journal
card is the second `Card` in the grid; the relevant behaviour is transcribed
into the Panel section below so this plan stands alone.

## Out of scope

- **`#tag` extraction and tag-chip filtering.** Present in the design, deferred
  by decision to a later slice. Nothing here should half-implement it: no tag
  parsing, no tag column, no chips.
- **Editing an existing entry.** The design has no edit affordance either. Noted
  because it constrains `ParsedEntry` — see the type note below.
- **The design's side-by-side layout.** Journal is its own panel; one panel at a
  time stands (ADR 0006).
- **Deduplicating the store machinery.** `server/journal.js` will duplicate the
  mutex + temp-file-and-rename + read-modify-write shape of `server/todos.js`.
  A separable refactor with a different shape from the rendering one; bundling
  them would make both harder to review. Recorded in ADR 0008 as the next
  trigger to watch. The mutex in `server/todos.js` is **module-global, not
  per-store**: duplicating it gives the two files independent write queues, which
  is correct and is exactly what a careless future dedup would break by
  collapsing both stores onto one queue.
- **Migrating anything.** `journal.md` does not exist yet; first run creates it.

## Design

### File format

`<dir>/journal.md`, created from a template on first run (same reasoning as
`FILE_TEMPLATE` in `server/todos.js`: the file must explain itself to whoever
opens it without the dashboard).

```markdown
# Journal

<!-- ctrl-centre journal. Edit by hand or in the dashboard — both write here. -->
<!-- An entry is a `## YYYY-MM-DD HH:MM` heading; everything until the next
     `##` heading is its text. Newest first. -->

## 2026-07-26 14:32

Shipped the CI slice. The matrix caught nothing, which is itself
information — Node 20 and 26 agree.

## 2026-07-25 09:10

Rotated the backup drive.
```

Parsing rules, following ADR 0002's line-preserving philosophy:

- An **entry heading** is a line matching
  `/^## (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\s*$/` at top level.
- A body **terminates** at the next line matching `/^#{1,2}\s/` — that is, at any
  h1 or h2, whether or not it is a timestamp — or at EOF. Headings of level 3 and
  deeper stay inside the body, because `### Sub-note` inside a journal entry is
  ordinary writing. A non-timestamp h2, or an h1 after the entries, therefore
  ends the entry and is preserved verbatim as free text; it never becomes an
  entry.
- Everything before the first entry heading is the **preamble**.
- Entry text **may contain newlines** — the sharpest difference from tasks, where
  the one-task-per-line rule makes that impossible. Nothing in the journal path
  may assume single-line text.

#### Fenced blocks and comments: recognition vs accumulation

These are two separate jobs, and conflating them is the trap. The todo parser has
only one job on a fenced line — skip it (`indexTasks`, `server/todos.js`
158–170).

- **Recognition** of an entry heading is suppressed inside a fence (``` or `~~~`)
  or an HTML comment. This is what lets the template's own comment document the
  format without becoming an entry.
- **Accumulation** is never suppressed. A fenced code block inside an entry body
  is captured into `text` verbatim, `##` lines and all.

An **unclosed** fence or comment therefore swallows every following heading, and
the rest of the file becomes one entry's body. That is the decided behaviour, not
an accident: `expectedText` means a delete can only remove what the client
actually saw, so the destructive case is visible in the UI before it happens.
Commit 1 asserts it with a fixture so it stays a decision.

#### Whitespace contract

The bit that decides whether `expectedText` produces false 409s, so it is spelled
out rather than left to the keyboard:

- The file is split on `/\r?\n/` on read, so a CRLF file yields no stray `\r`.
  Incoming text from the wire is normalized the same way before splicing.
- `text` is the body lines joined with `\n`, with leading and trailing **blank
  lines** dropped. Per-line trailing whitespace is **preserved** — two trailing
  spaces is a markdown hard break and deleting it would silently rewrite the
  user's prose. No `trimEnd()` per line, no `.trim()` of the whole body.
- `expectedText` is compared byte-for-byte against `text` produced by that same
  rule, so a round trip through the panel cannot mismatch.

#### Entry region, insertion and deletion

An entry **occupies** its heading line through the line before whatever
terminated it — trailing blank lines included. `ParsedEntry.endLine` is that last
occupied line, *not* the last non-blank body line. This is the definition that
makes delete non-accumulating.

- **Serialize** an entry as `['## <ts>', '', ...bodyLines, '']`.
- **Delete** splices `startLine` through `endLine` inclusive. Because the region
  owns its trailing blanks, neighbours keep exactly one blank line between them
  and repeated add/delete cannot make the file drift.
- **Insert** puts the new entry's lines immediately after the preamble, and
  collapses the blank run between the preamble's last non-blank line and the
  first heading to exactly **one** blank line.

That last rule costs a promise, so amend it honestly: the preamble is preserved
byte-for-byte **except for the blank run immediately before the first entry**,
which is normalized to one blank line. The no-entries-yet and empty-file cases
need their own branch, mirroring `server/todos.js` 338–341.

Two tests exist specifically to pin this down: **add twice into a fresh template
is blank-line-stable**, and **add-then-delete returns the file to its prior
bytes**.

### Timestamps

`## YYYY-MM-DD HH:MM`, local wall-clock, no offset. Chosen for legibility in a
hand-edited file, and because the design displays local time.

**The client's clock stamps the entry**, not the server's. `NewEntry` carries an
optional `timestamp`; the store validates it against the heading regex and
rejects a malformed one with 400, falling back to its own clock only when the
field is absent. This follows the established pattern — `public/panels/todo.js`
34–38 computes `todayISO()` client-side and sends the date in the body, and the
top-bar clock (`public/app.js` 68) is browser-local. A server running under
`TZ=UTC` would otherwise file a 23:50 entry under tomorrow's date, disagreeing
with the clock two inches above it on screen.

Costs to record as consequences: an entry written at 01:30 on a DST fall-back
night is ambiguous, and entries written in different timezones sort by wall-clock
rather than by true instant. Acceptable for a personal journal; not acceptable if
this ever merges across devices.

### Identity and conflict detection

Reuse ADR 0005 exactly — no new mechanism. An entry's `ordinal` is its position
among entries in the file as read, and every mutation carries the text the client
saw.

- `POST /api/journal/delete` takes `{ ordinal, expectedText }`.
- The store re-reads, resolves the ordinal, compares the text, and rejects with
  **409** on mismatch or a vanished ordinal.
- Writes go through the in-process mutex, committed via temp file + `rename`.
- The panel reloads from disk on 409 and shows a banner, as the todo panel does.

Worth recording in ADR 0008, because ADR 0005 did not anticipate it: on a
multi-line body this guard is **much stricter** than on a task line. Any hand
edit anywhere in an entry blocks deleting it until the panel reloads. The
alternative — comparing the machine-written timestamp heading instead of the body
— is looser and was rejected: the heading is not unique (two entries in one
minute) and the point of the guard is that the user saw what they are removing.

### Shapes (`types.d.ts`) — commit 1, not commit 3

All five cross the server→JSON→client boundary, and `server/journal.js` opens
with typedef imports the way `server/todos.js` 17–25 does, so `tsc` fails without
them from commit 1 onward.

```ts
export interface JournalEntry {
  ordinal: number;              // position among entries; not stable across edits
  timestamp: string;            // `YYYY-MM-DD HH:MM` local, as written in the file
  text: string;                 // may contain newlines
}
export interface ParsedEntry extends JournalEntry {
  startLine: number;            // heading line, zero-based
  endLine: number;              // last occupied line, trailing blanks included
}
export interface JournalDocument { lines: string[]; entries: ParsedEntry[]; }
export interface NewEntry { text: string; timestamp?: string }
export interface EntryRef { ordinal: number; expectedText?: string }
```

`ParsedEntry` carries no preservation fields — no analogue of `indent`/`bullet` —
which is fine while mutations are add-and-delete only. The deferred edit
affordance will change this type.

### API

Mirrors the todo routes: every mutation responds with the full new list, so the
client never patches local state.

| Route | Method | Body | Response |
|---|---|---|---|
| `/api/journal` | GET | — | 200 `{ file, entries }` |
| `/api/journal` | POST | `NewEntry` | 201 `{ entries }` |
| `/api/journal/delete` | POST | `EntryRef` | 200 `{ entries }` |

Validation lives in the store and **rejects** rather than throwing synchronously
(project convention). Empty or whitespace-only text → 400. Malformed
`timestamp` → 400. Reuse the existing `MAX_BODY_BYTES` guard; do not add a
separate length cap — but note that 64 KiB (`server/index.js` 10) is now
reachable by pasting into a textarea, and the over-limit path `req.destroy()`s
mid-stream, so `api()` may surface a network error instead of the 413 message.
Accept and record; a client-side guard is a follow-up.

### Panel

`public/panels/journal.js` exporting the standard
`{ id, label, icon, title, mount(host) → cleanup }`, registered in
`public/app.js` as a **new** entry after Tasks:
`{ id: 'journal', label: 'Journal', icon: '◨', panel: journalPanel }` — note the
required `panel:` key — leaving the `notes` placeholder alone. The design's
sidebar has no Journal row, so this adds one rather than repurposing Notes.
`◨` deliberately mirrors Overview's `◧`; change it if they read as a pair.

From the design's Journal card: a textarea placeholder `Write today's entry…`,
a `Save entry` button aligned right, the entry count as the card description
(`N entries` / `1 entry`), a list capped at `max-height: 420px` with its own
scroll, and per entry a mono date label, the body with `white-space: pre-wrap`,
and a ghost `×` delete button. Empty state:
`No entries yet — write your first above.` Date label format from the design:
`Jul 26, 2026 · 02:34 PM`.

`textarea.field` already exists in `public/styles/base.css` 32, so less new CSS
is needed than it looks.

Entry text comes from a file on disk: render with `textContent`, never
`innerHTML` — and `pre-wrap` means newlines survive without any HTML.

**Commit 3 duplicates the todo panel's card, row and field markup on purpose.**
That is the requested ordering: two real call sites first, then extract. Do not
pre-emptively abstract in commit 3.

### No client-side test harness

`test/` holds only `server.test.js` and `todos.test.js`; there is no DOM harness
and ADR 0003 blocks adding one. So for commits 3 and 4 the automated signal is
`tsc` plus the server suites, and the rest is a written manual script. `tsc` will
not catch a dropped `aria-label`, a renamed class, or a `text:` becoming `html:`.

**Manual script (commits 3 and 4 both run it):**

1. `npm start`, open the dashboard, click **Journal**.
2. Empty state reads `No entries yet — write your first above.`
3. Type a two-paragraph entry, click **Save entry**. It appears at the top; both
   paragraphs' line breaks are intact; the count reads `1 entry`.
4. `cat <dir>/journal.md` — heading is `## YYYY-MM-DD HH:MM` matching your wall
   clock, body below it, template comment untouched.
5. Add a second entry. It appears **above** the first, and in the file above it.
6. Delete the first-listed entry. It goes; the other is untouched; no blank-line
   drift in the file (`git diff` on a scratch copy, or compare byte counts).
7. Edit the remaining entry by hand in an editor, then click its `×` in the
   still-open page: expect a **409 banner** and a reload, not a deletion.
8. Reload the page; the list matches the file.

### The ADR 0003 trigger

`docs/adr/README.md` 26 lists "a second panel starts duplicating card and row
markup" as a condition that should prompt a new record, and points at 0003. 0003
is immutable, so follow the pattern this repo just set with 0007 (see
`docs/plans/data-dir.md`): ADR 0008 supersedes **only** the rendering-layer
consequence of 0003 — the no-dependency, no-build decision itself stands
untouched — the index table carries the annotation, and 0003's own file is not
edited. 0008 must also state the **next** threshold, since it answers the Preact
question with "not yet" for the second time.

Helpers go in a **new `public/lib/components.js`**, not `public/lib/dom.js`:
that file is documented as a minimal DOM helper and `el()`'s `html` branch is
justified by the comment "only ever called with literals we author" (`dom.js`
27). App-level component builders that take caller content do not belong behind
that comment, and file-sourced journal text is precisely what must never reach
`innerHTML`.

Name only what two call sites justify. `card()` and `field()` wrap stable
design-system classes (`base.css` 28–40) and are safe. `row()` is speculative —
`.todo-row` is app-specific (`app.css` 50), and a journal row (mono date +
`pre-wrap` body + `×`) shares with a todo row (checkbox + text + due + badge +
`×`) only "flex container, border-bottom, trailing ghost button". Ship two
helpers if the third does not earn itself.

## Commits

1. **Add the journal markdown store** — `server/journal.js`, the shapes in
   `types.d.ts`, `journal.md` added to `.gitignore` (the safety net ADR 0001
   exists for; `docs/plans/data-dir.md` deferred broadening it until a second
   data file existed, and this is it), and `test/journal.test.js`.
   Test: a fixture with preamble, multi-line bodies, a fenced example heading, an
   HTML-commented heading, a non-timestamp h2, an h1 after the last entry, a
   fenced code block **inside** a body containing a `##` line (captured
   verbatim), and an unclosed fence (swallows to EOF); add prepends after the
   preamble; add twice into a fresh template is blank-line-stable;
   add-then-delete restores the prior bytes; delete preserves everything else;
   `expectedText` mismatch rejects with 409; blank text and malformed
   `timestamp` reject with 400; CRLF input round-trips without `\r`; trailing
   two-space hard breaks survive; concurrent adds serialise; no `.tmp` files left
   behind; first run creates the template. Mirror `test/todos.test.js`.
2. **Expose the journal over `/api/journal`** — routes in `server/index.js`,
   store constructed alongside `todos` from `config.dir`. Test: extend
   `test/server.test.js` — GET returns `{ file, entries }` with the display path,
   POST 201s and the entry appears, delete 200s, stale `expectedText` 409s,
   non-POST mutation 405s. Add a `seedJournal()` helper and have every journal
   test call it first: that file has `before`/`after` only, one temp dir for the
   whole process, and the store's first `list()` creates the file — so a test
   asserting an empty list after a sibling added an entry would fail. Keep the
   temp-directory guard at the top of the file.
3. **Add the journal panel** — `public/panels/journal.js`, registry entry in
   `public/app.js`, styles in `public/styles/app.css`. Markup duplicated from the
   todo panel deliberately. Test: `npm run check`, plus the manual script above.
4. **Extract shared card and field helpers** — new `public/lib/components.js`,
   both panels pointed at it. Test: `npm run check` green unchanged, **plus a
   markup-identity check**: capture a rendered todo row's and card's `outerHTML`
   before the refactor and after, and confirm they are identical. Line count is
   explicitly *not* the criterion — a six-positional-arg helper would shrink
   todo.js while making both panels worse. Re-run the manual script.
5. **Record ADR 0008 and update the docs** — the 0003 trigger fired, what was
   chosen, why Preact is deferred again, the next threshold, and the
   multi-line-`expectedText` cost that ADR 0005 did not anticipate;
   `docs/adr/README.md` index row and triggers list; CLAUDE.md gains an
   "Editing the user's journal" section parallel to the todos one — an agent will
   be asked "write a journal entry for me", and the format spec is duplicated in
   the template, so say they must be kept in sync; README describes the journal
   file. Test: none beyond `npm run check`.

## Status

All five commits done. 92 tests pass (59 before this branch, 33 new), typecheck
clean. Commits 1–3 were implemented by a Sonnet subagent against this plan;
commits 4–5 and all verification were done directly.

### Deviations

- **Commit 4 extracted `card()`, `banner()` and `storageLabel()`, not `card()`
  and `field()`.** With both call sites in front of us, `field()` would only have
  concatenated a class string onto three different element types, and `row()`
  (already flagged speculative) shares almost nothing between a journal row and
  a todo row. The banner, by contrast, was duplicated *behaviour* — the same two
  properties set the same way — which is the kind that stops matching. Recorded
  in ADR 0008.
- **`server/index.js` computes `path.join(config.dir, 'journal.md')` locally**
  rather than `config.js` growing a `journalFile` field, for one caller.
- **`FILE_TEMPLATE` ends with exactly one trailing newline.** Required, not
  cosmetic: `add` normalizes the gap before the first entry to one blank line, so
  a template already in that canonical shape is what makes add-then-delete
  byte-stable. Pinned by its own test.
- Timestamp validation is shape-only — `2026-13-40 25:99` passes the regex. This
  matches how the todo store treats `@YYYY-MM-DD`, so it is consistent rather
  than newly sloppy.

### Verified

- `npm run check`: 92/92, typecheck clean, run with `HOME` pointed at an empty
  temp dir; no file created at the default location.
- **Markup identity for commit 4**: the rendered Tasks panel `innerHTML` hashed
  `bb32e498` at 3236 chars both before and after the refactor — captured in
  Chrome against a running server, which is the falsifiable check that line count
  would not have given.
- **Manual script, in Chrome**: empty state, two-paragraph entry with a
  blank line and a two-space hard break saved and rendered with `pre-wrap`
  intact, count going `2 entries` → `3 entries`, textarea cleared, the entry
  landing above the older ones both on screen and in the file.
- **Client clock**: the saved entry's heading read `13:29`, matching the
  dashboard's own top-bar clock at that moment.
- **On-disk shape**: preamble untouched, exactly one blank line before the new
  heading, interior blank line and trailing two spaces preserved byte-for-byte.
- **409 path**: hand-edited the file in an editor with the page still open, then
  clicked delete — banner shown, entry *not* deleted, list resynced to the
  edited text.
- **Byte stability**: a live add-then-delete round trip through the API left the
  file byte-identical (`Buffer.compare === 0`), with no blank-line drift and a
  single trailing newline.
- Both panels still switch and render correctly after the refactor.
