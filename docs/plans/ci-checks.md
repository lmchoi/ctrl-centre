# Plan: CI runs checks

## Goal

Every push to `main` and every pull request runs `npm run check` (typecheck +
tests) on GitHub Actions, and the result is visible on the PR.

## Out of scope

- Publishing, releases, deploys — there is nothing to deploy.
- Lint. There is no linter in this repo; adding one is a separate decision.
- Coverage reporting.
- Branch protection rules (a repo setting, not a file in the repo).

## Design

One new file, `.github/workflows/ci.yml`. Nothing else changes — no new
dependencies, no changes to `package.json` scripts. `npm run check` is already
the single entry point the project documents, so CI calls exactly what a human
calls locally (CLAUDE.md: "Run `npm run check` before considering work done").

Decisions:

- **Triggers**: `push` to `main` and `pull_request`. Both, so the badge tracks
  `main` and PRs get a status before merge.
- **Node matrix `[20, 26]`**: `package.json` declares `engines.node >= 20` but
  nothing tests that floor — development happens on 26. Two entries make the
  claim real at both ends without a wide matrix. Sequential, ~30s each.
- **`npm ci`, not `npm install`**: the lockfile is committed and CI should fail
  on a lockfile that has drifted rather than silently updating it. Only
  devDependencies get installed (`typescript`, `@types/node`) — per ADR 0003 the
  runtime needs nothing, but `npm run typecheck` needs `tsc`.
- **`cache: npm`** on `setup-node`, keyed off `package-lock.json`.
- **Concurrency group per ref, `cancel-in-progress: true`**: a personal repo does
  not need to finish superseded runs.
- **Pinned major action versions** (`actions/checkout@v5`,
  `actions/setup-node@v5`) rather than SHAs. Consistent with the project's
  "readable over hardened" posture for a single-author personal tool.

Not testable by the test suite: a workflow file's only real validation is a run
against GitHub. The plan therefore treats "the PR's own check run is green" as
the acceptance criterion, verified with `gh run` before the PR is handed over.

## Commits

1. Add `.github/workflows/ci.yml` running `npm run check` on Node 20 and 26 —
   test: `npm run check` still passes locally; the PR's own check run goes green
   on both matrix legs (verified via `gh pr checks` / `gh run view`).
2. Add the CI status badge to `README.md` — test: none beyond `npm run check`;
   cosmetic, and the badge URL is only meaningful once commit 1 is on the
   default branch.
