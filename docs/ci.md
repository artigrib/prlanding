# CI

Workflow: `.github/workflows/site-tests.yml` (runs on pull requests to `main`, pushes to `main`, and manually).
All jobs run in parallel; npm downloads and the Playwright Chromium build are cached (`.github/actions/playwright`).

| Job | Checks |
| --- | --- |
| `build-check` | `node tools/build.mjs` leaves the tree unchanged (no forgotten regenerated `sada/*` pages or sitemap). |
| `arena` | `npm ci && npm run build && npm run vendor-three` in `sim/arena` reproduces the committed `sim/arena/build/` and the site's shared `vendor/three/` (three.js for the product pages, the SO-101 sim and the arena); then `node --test sim/arena/tests/*.test.mjs` (replay codec). |
| `hf-space` | `node tools/hf/build-space.mjs` then `node tools/hf/check-imports.mjs`: every import, script and preload reachable from the Space pages resolves inside `dist-hf/<space>/`. |
| `so101-unit` | Runs `node --test` on tests under `sim/so101/test*/` (skipped if none exist). |
| `smoke` | Playwright/Chromium against `python3 -m http.server`: home, catalog filter, product pages (so101, svrn, vert150), `/sim/so101/`, `/sim/arena/?robot=svrn`. Fails on uncaught page errors, console errors and HTTP 4xx/5xx (Google Fonts ignored). Then builds the Spaces and runs `tests/smoke-space.mjs` against `dist-hf/so101-sim` and `dist-hf/arena`, each served at its own root (sim loads, the AI panel modules import). |
| `backend-api`, `backend-bridge` | `npm ci`, `npm run typecheck` and the unit tests of `backend/api` and `backend/bridge` (incl. the bridge-client schema sync test and the relay heartbeat with a manual clock). |
| `e2e-so101` | `sim/so101/tests/e2e.cjs`: the sim UX in Chromium with software GL; simulated time only through the `?test=1` hooks (`advance`, `renderNow`), no retries. Screenshots are uploaded on failure. |
| `e2e-arena-replay` | `sim/arena/tests/replay-e2e.cjs` against `python3 -m http.server`. |
| `e2e-bridge` | `backend/bridge` `npm run test:e2e`: relay + MCP client + a Chromium tab (mock page and the real so101 sim). |

## Run locally

```
node tools/build.mjs && git status --short          # must be clean
(cd sim/arena && npm ci && npm run build) && git status --short
python3 -m http.server 8123 &
npm ci && npx playwright install chromium            # root package.json pins playwright
npm run smoke                                         # BASE=http://host:port to override
npm run test:unit                                     # so101 + arena node tests
node sim/so101/tests/e2e.cjs                          # starts its own server
node sim/arena/tests/replay-e2e.cjs http://127.0.0.1:8123
(cd backend/bridge && npm ci && npm run test:unit && npm run test:e2e)
(cd backend/api && npm ci && npm test)
```

## Require the checks on `main` (repo owner)

Settings → Branches → add a branch protection rule (or ruleset) for `main`:

1. Enable "Require a pull request before merging".
2. Enable "Require status checks to pass before merging" and add: `build-check`, `arena`, `so101-unit`, `smoke`,
   `backend-api`, `backend-bridge`, `e2e-so101`, `e2e-arena-replay`, `e2e-bridge`
   (a check appears in the search box only after it has run once).
3. Optionally enable "Require branches to be up to date before merging", then save.
