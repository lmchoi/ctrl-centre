# ctrl-centre

Personal dashboard. Node + vanilla ES modules, no runtime dependencies and no
build step. `npm start` serves http://127.0.0.1:4242.

```
server/index.js    HTTP: static files + JSON API
server/todos.js    markdown parse / serialize / mutate
server/config.js   data directory + port resolution
public/app.js      panel registry, sidebar, clock
public/panels/     one module per panel
public/styles/     Console design system (tokens.css, base.css) + app.css
types.d.ts         shapes shared between server and client
test/              node --test suites
docs/adr/          architecture decision records
```

**Run `npm run check` (typecheck + tests) before considering work done.**

Read [docs/adr](docs/adr/) before proposing an architectural change — the
decisions there record what was already considered and rejected, and why.
ADRs are immutable: supersede with a new one rather than editing.

## Editing the user's todos

The todo file lives **outside this repo** — that is deliberate, personal todos
must never be committed here. It sits in the data directory named by
`CTRL_CENTRE_DIR` (default `~/.ctrl-centre`), which holds one markdown file per
panel ([ADR 0007](docs/adr/0007-personal-data-in-a-directory.md)). Resolve its
path with:

```sh
npm run todo:path          # or: echo "${CTRL_CENTRE_DIR:-$HOME/.ctrl-centre}/todos.md"
```

**Never point a test suite at that directory.** `test/server.test.js` asserts it
is running against a temp directory before it constructs the store; keep that
guard when adding suites that touch the real store.

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

## Workflow

Feature work goes through the `sp` slice workflow: `/sp:refine` → `/sp:start` →
`/sp:implement` → `/sp:push` → `/sp:done`. Bug fixes enter at `/sp:fix`.
Plan files live in `docs/plans/`; worktrees are created under
`.claude/worktrees/` (gitignored).

### sp config
- test: `npm run check`
- sync: `npm ci`
- plans: `docs/plans/`
- docs: `docs/adr/`

## Conventions

- No runtime dependencies and no build step ([ADR 0003](docs/adr/0003-no-runtime-dependencies-no-build-step.md)).
  Keep it that way unless asked. `typescript` and `@types/node` are
  development-only and must never be imported by shipped code.
- Types are JSDoc annotations checked by `tsc`, not TypeScript syntax
  ([ADR 0004](docs/adr/0004-jsdoc-types-instead-of-typescript.md)). Shapes that
  cross the server/client boundary belong in `types.d.ts`.
- Every store method returns a promise, including on invalid input — validation
  errors reject, they do not throw synchronously.
- Todo text comes from a file on disk: render it with `textContent`, never
  `innerHTML`.
- Every todo-file write is read-modify-write under a mutex, via temp file +
  rename. Mutations carry the text the client saw and 409 on mismatch — don't
  remove that guard, it's what stops a stale tab editing the wrong line.
