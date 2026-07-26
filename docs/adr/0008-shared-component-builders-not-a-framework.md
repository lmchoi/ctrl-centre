# 8. Shared component builders, not a framework — yet

Date: 2026-07-26

## Status

Accepted

Supersedes the *rendering-layer consequence* recorded in
[0003](0003-no-runtime-dependencies-no-build-step.md) — the one its own
Consequences section flagged as "the point to revisit". The no-dependency,
no-build decision itself is untouched and still binding.

## Context

[0003](0003-no-runtime-dependencies-no-build-step.md) closed with a named
trigger, repeated in the ADR index: *when a second panel starts copying card and
row markup, move to Preact + htm vendored as two local files. Not before: one
panel does not justify it.*

The journal panel is that second panel. Adding it produced exactly the predicted
duplication — an identical three-part card scaffold (`card` / `card-header` +
`card-title` + description / `card-content` / `card-footer`), an identical
`banner` element, and the same two-property update applied to it on every
render.

The duplication was committed first and deliberately, so that the extraction
could be judged against two real call sites rather than one imagined one.

## Decision

Extract plain functions into `public/lib/components.js`. Do not adopt Preact.

- `card({ title, description, content, footer })` — the three-part scaffold.
- `banner()` — the error banner plus its `show(message)` rule, extracted for the
  update as much as the markup: `data-visible` driving the CSS is the kind of
  detail that silently diverges once written twice.
- `storageLabel(className)` — the footer path label. `className` stays a
  parameter so each panel keeps its styling hook and the rendered markup is
  unchanged by the extraction.

Deliberately **not** extracted, having looked at both call sites:

- `row()` — a journal row (mono date, `pre-wrap` body, `×`) and a todo row
  (checkbox, text, due date, badge, `×`) share only "flex container,
  border-bottom, trailing ghost button". A helper covering both would take more
  configuration than it removes.
- `field()` — would have concatenated a class string onto three different
  element types.

A new file rather than growing `public/lib/dom.js`: that file is documented as a
minimal DOM helper, and its `html` option is justified in a comment reading
"only ever called with literals we author". These builders take caller-supplied
*elements*, so keeping them in a separate module keeps that comment true, which
matters because journal text is file-sourced and must never reach `innerHTML`.

## Alternatives considered

- **Preact + htm, vendored** — what 0003 proposed, and the honest case for it is
  that the design source is component-shaped (`Card`, `CardHeader`, `Button`),
  so JSX-ish markup would read closer to the design than `el()` calls do.
  Rejected for now: after extraction the actual duplication left between the two
  panels is small, and adopting a rendering library to remove it would rewrite
  both working panels and put a vendored runtime in the debug path. The
  no-build property would survive; the "what you debug is what you wrote"
  property would be weaker.
- **Leave the duplication** — defensible for two panels, and rejected because
  the banner's update logic is behaviour, not markup, and behaviour that must
  match in two places is the kind that stops matching.
- **A `panel()` builder owning the whole mount lifecycle** — load, render,
  error, busy state. Genuinely tempting, since both panels share that shape too.
  Rejected as premature with two samples, and it would have made the diff for
  this slice much harder to review.

## Consequences

Good:

- One place to change the card scaffold, and the banner's visibility contract
  exists once.
- Verified as a true refactor, not a rewrite: the rendered Tasks panel
  `innerHTML` hashed identically before and after (`bb32e498`, 3236 chars).
  Line count was explicitly rejected as the criterion — a helper with six
  positional arguments would have shrunk the caller and made both panels worse.

Bad:

- Two ways to build a card now exist in principle (helper, or `el()` by hand),
  and nothing enforces the helper. With no client-side test harness — ADR 0003
  blocks adding one — `tsc` is the only automated guard, and it will not catch a
  dropped `aria-label` or a `text:` becoming `html:`.
- `storageLabel(className)` takes a parameter purely to preserve existing
  markup. That is the right trade today and it is also a smell: two panels
  styling the same element differently.

## The next threshold

This answers the Preact question with "not yet" for the second time, so the
condition for asking a third time should be sharper than "more duplication":

- **A third panel needs the same mount lifecycle** — load / render / error /
  busy / 409-reload. That is the shape this ADR deliberately did not extract,
  and three samples of it would be a real signal.
- **Or any panel needs to re-render a list without rebuilding every row** —
  keyed reconciliation is where hand-written DOM stops being cheaper than a
  library, and neither panel needs it today.

Also still open, from the journal slice and separate from rendering:

- **The store machinery is now duplicated.** `server/journal.js` copies the
  mutex, temp-file-and-rename, and read-modify-write shape of
  `server/todos.js`. A third store makes that extraction worth doing — with the
  caveat that the two queues are independent today, and a careless dedup that
  puts both files behind one queue would make a slow todo write stall a journal
  entry.
- **`expectedText` is a stricter guard on a journal entry than ADR 0005
  anticipated.** On a one-line task it rarely misfires; on a multi-line body,
  any hand edit anywhere in the entry blocks deleting it until the panel
  reloads. Acceptable, and worth revisiting if it becomes annoying in practice.
