# CI

Workflow: `.github/workflows/site-tests.yml` (runs on pull requests to `main`, pushes to `main`, and manually).

| Job | Checks |
| --- | --- |
| `build-check` | `node tools/build.mjs` leaves the tree unchanged (no forgotten regenerated `sada/*` pages or sitemap). |
| `arena` | `npm ci && npm run build` in `sim/arena` reproduces the committed `build/`. |
| `so101-unit` | Runs `node --test` on tests under `sim/so101/test*/` (skipped if none exist). |
| `smoke` | Playwright/Chromium against `python3 -m http.server`: home, catalog filter, product pages (so101, svrn, vert150), `/sim/so101/`, `/sim/arena/?robot=svrn`. Fails on uncaught page errors, console errors and HTTP 4xx/5xx (Google Fonts ignored). |

## Run locally

```
node tools/build.mjs && git status --short          # must be clean
(cd sim/arena && npm ci && npm run build) && git status --short
python3 -m http.server 8123 &
npm i --no-save playwright@1.56.0 && npx playwright install chromium
node tests/smoke.mjs                                  # BASE=http://host:port to override
```

## Require the checks on `main` (repo owner)

Settings → Branches → add a branch protection rule (or ruleset) for `main`:

1. Enable "Require a pull request before merging".
2. Enable "Require status checks to pass before merging" and add: `build-check`, `arena`, `so101-unit`, `smoke`
   (a check appears in the search box only after it has run once).
3. Optionally enable "Require branches to be up to date before merging", then save.
