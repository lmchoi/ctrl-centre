# ctrl-centre

Personal dashboard. Dependency-free Node + vanilla ES modules, no build step.
`npm start` serves http://127.0.0.1:4242.

```
server/index.js    HTTP: static files + JSON API
server/todos.js    markdown parse / serialize / mutate
server/config.js   todo file path + port resolution
public/app.js      panel registry, sidebar, clock
public/panels/     one module per panel
public/styles/     Console design system (tokens.css, base.css) + app.css
```

## Editing the user's todos

The todo file lives **outside this repo** — that is deliberate, personal todos
must never be committed here. Resolve its path with:

```sh
npm run todo:path          # or: echo "${CTRL_CENTRE_TODO_FILE:-$HOME/.ctrl-centre/todos.md}"
```

You may edit that file directly with normal file tools. It is plain markdown.

### Format

A task is any GitHub-style checklist line:

```markdown
- [ ] Renew domain — console.dev !high @2026-08-01
- [x] Review weekly budget !low
- [ ] Rotate backup drive offsite
```

- `- [ ]` open, `- [x]` done.
- `!high` / `!medium` / `!low` — priority. **Omitted means medium**; don't write
  `!medium` explicitly, the serializer omits it.
- `@YYYY-MM-DD` — due date, optional.
- Tokens go at the end of the line. One task per line — a task's text can never
  contain a newline.

### Rules

- Only checklist lines are parsed. Headings, prose, HTML comments, blank lines
  and indented items are all preserved verbatim on write — **keep them**, and
  don't reformat or reorder lines you weren't asked to touch.
- Checklist lines inside HTML comments (`<!-- ... -->`) or fenced code blocks
  (``` or `~~~`) are **not** tasks — they're documentation. That's how the
  file's own header can show `- [ ]` examples without them becoming real todos.
  Put example tasks in a fence or comment; put real ones at top level.
- Complete a task by flipping `[ ]` to `[x]`. Don't delete it unless asked.
- Indented checklist items parse as ordinary tasks, not subtasks. Nesting is
  visual only.
- If the dashboard is running in a browser, it won't see your edit until the
  page is refreshed. Mention that when you change the file.

The same spec is embedded as a comment block at the top of newly created todo
files (`FILE_TEMPLATE` in `server/todos.js`) — keep the two in sync if you
change the grammar.

## Adding a panel

Create `public/panels/<name>.js` exporting
`{ id, label, icon, title, mount(host) → cleanup? }`, import it in
`public/app.js`, and replace that entry's `panel: null` in the `PANELS`
registry. The sidebar entry enables itself. Server state, if needed, goes
behind a new `/api/<name>` route in `server/index.js`.

## Conventions

- No dependencies and no build step. Keep it that way unless asked.
- Todo text comes from a file on disk: render it with `textContent`, never
  `innerHTML`.
- Every todo-file write is read-modify-write under a mutex, via temp file +
  rename. Mutations carry the text the client saw and 409 on mismatch — don't
  remove that guard, it's what stops a stale tab editing the wrong line.
