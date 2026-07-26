# 6. Panels are self-contained modules in a registry

Date: 2026-07-26

## Status

Accepted

## Context

Todos are the first panel, not the only one: "in the future, this dashboard will
include additional panels to meet different needs". Whatever shape the first
panel takes will be copied by the next few, so it is worth getting the seam
right while there is only one.

## Decision

A panel is a module exporting one object:

```js
export const todoPanel = {
  id: 'tasks',
  label: 'Tasks',
  icon: '☑',
  title: 'Tasks',
  mount(host) { /* build DOM into host; return optional cleanup */ },
};
```

`public/app.js` holds a `PANELS` array. The shell owns the sidebar, the title
bar and the clock; panels own everything inside the content area. Panels that
don't exist yet appear in the registry with `panel: null` and render as disabled
sidebar entries, so the dashboard shows its own roadmap.

Server-side state for a panel, when it needs any, goes behind its own
`/api/<name>` route.

## Alternatives considered

- **A page per panel** — full reloads, and the shell would be duplicated or
  templated server-side. Rejected as heavier than the problem.
- **A client-side router with URL routes** — the right answer if panels ever
  need to be linkable. Rejected for now as unnecessary machinery for one panel.

## Consequences

Good:

- Adding a panel is one new file plus one line in the registry, and the sidebar
  entry enables itself.
- Panels are isolated: a panel can be deleted by removing its file and its line.
- The disabled entries communicate intent without shipping stub implementations.

Bad:

- Every panel's code loads on every page load. Fine at this scale; if the
  dashboard grows large, `mount()` is the natural place to switch to a dynamic
  `import()`.
- There is no URL per panel, so a panel cannot be linked or bookmarked and the
  browser back button does not move between them. Revisit if panels become
  shareable — that is the trigger for adding a router.
- `mount()` returning an optional cleanup function is a convention the registry
  cannot enforce. A panel that starts a timer and forgets to return cleanup will
  leak it.
