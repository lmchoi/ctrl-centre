# ctrl-centre

[![CI](https://github.com/lmchoi/ctrl-centre/actions/workflows/ci.yml/badge.svg)](https://github.com/lmchoi/ctrl-centre/actions/workflows/ci.yml)

A personal dashboard. Two panels — **Tasks** and **Journal** — each backed by a
plain markdown file that lives outside this repo.

No runtime dependencies, no build step. Node 20+.

```sh
npm start          # http://127.0.0.1:4242
npm run dev        # same, restarts on change

npm test           # node --test
npm run typecheck  # tsc --noEmit over JSDoc types
npm run check      # both
```

`npm install` is only needed for `typecheck` — running the app needs nothing
installed. See [docs/adr](docs/adr/) for why things are built this way.

## Where your data lives

One directory outside this repo, one markdown file per panel. By default
`~/.ctrl-centre/`, holding `todos.md` and `journal.md`, each created on first
use. Nothing personal is ever written into this repo.

Point it somewhere else (a Dropbox/iCloud folder, a notes vault) with:

```sh
CTRL_CENTRE_DIR=~/Documents/notes/ctrl-centre npm start
```

`npm run todo:path` prints the resolved todo file path.

Other env vars: `PORT` (default `4242`), `HOST` (default `127.0.0.1`).

## The todo file format

Any GitHub-style checklist line is a task:

```markdown
# Todos

## Work
- [ ] Renew domain — console.dev !high @2026-08-01
- [ ] Rotate backup drive offsite
- [x] Review weekly budget !low
```

- `!high` / `!medium` / `!low` — priority. Omitted means medium.
- `@YYYY-MM-DD` — due date. Shown in the row; turns red when overdue.

Edit the file by hand or use the dashboard; both write the same file. Everything
that isn't a checklist line — headings, prose, comments, nested items — is
preserved exactly as written, so the file stays yours. Checklist lines inside
HTML comments or fenced code blocks are treated as examples, not todos.

Newly created todo files get this spec as a comment block at the top, so an
editor or a coding agent that opens the file cold knows the rules without
needing this README. `CLAUDE.md` carries the same spec for agents working in
this repo, plus `npm run todo:path` to locate the file.

If the file changed on disk since the page loaded, the affected action is
rejected with a conflict and the panel resyncs rather than editing the wrong
line. Refresh the page to pick up outside edits.

## The journal file format

An entry is a `## YYYY-MM-DD HH:MM` heading — local time, nothing else on the
line — and everything up to the next `##` is its text:

```markdown
# Journal

## 2026-07-26 14:32

Shipped the CI slice. Entry text can span several lines,
and blank lines, unlike a task.

## 2026-07-25 18:40

Rotated the backup drive.
```

- Newest first. New entries land directly below the file's header.
- A `###` heading stays inside its entry; any `#` or non-timestamp `##` ends it.
- Trailing whitespace is preserved, so markdown hard breaks survive.
- The same preservation and conflict rules as the todo file apply.

## Adding a panel

Panels are self-contained modules. Create `public/panels/<name>.js`:

```js
export const habitsPanel = {
  id: 'habits',
  label: 'Habits',
  icon: '◔',
  title: 'Habits',
  mount(host) {
    // build DOM into `host`; return an optional cleanup function
  },
};
```

Then import it in `public/app.js` and replace that row's `panel: null` in the
`PANELS` registry. The sidebar entry becomes enabled automatically. Server-side
state, if the panel needs any, goes in `server/` behind a new `/api/<name>` route
in `server/index.js`.

## Layout

```
server/
  index.js     HTTP: static files + JSON API
  todos.js     markdown parse / serialize / mutate
  config.js    todo file path + port resolution
public/
  index.html   app shell
  app.js       panel registry, sidebar, clock
  lib/dom.js   DOM + fetch helpers
  panels/      one module per panel
  styles/      design tokens + component CSS
test/          node --test suites
types.d.ts     shapes shared between server and client
docs/adr/      architecture decision records
```

`styles/tokens.css` and `styles/base.css` are the Console design system —
edit those to restyle everything at once.
