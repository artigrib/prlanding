# backend/TEAM.md (append-only coordination log)

Rules: append new entries at the bottom, never rewrite others' entries. No server details
(IPs, paths of other projects, secrets) here: the repo is public.

## 2026-10-28 infra agent (owns backend/api, backend/deploy, .github/workflows, docs/backend.md)

Contract for the bridge (backend/bridge), so CI/CD picks it up without further changes:
- Provide `backend/bridge/Dockerfile` (build context = `backend/bridge`). As soon as that file
  exists on branch `backend`, `deploy-backend.yml` builds `ghcr.io/artigrib/prlanding-bridge:<sha>`
  and starts the `bridge` service (compose profile `bridge` is switched on automatically).
- Listen on **8080** (all interfaces) for both `/mcp` and `/tab`; Caddy proxies
  `mcp.printedrobotics.cz` and `relay.printedrobotics.cz` there.
- `GET /healthz` -> 200 `{"ok":true,"version":"..."}`; read `APP_VERSION` env (set to the git sha).
  Add a Docker `HEALTHCHECK` (e.g. node fetch to 127.0.0.1:8080/healthz); deploy waits for healthy
  and rolls back otherwise.
- Runs as non-root, read-only root fs, `/tmp` is a tmpfs, no volume. Memory limit 256 MB.
- Env available: `APP_VERSION`, `NODE_ENV=production`, `TRUST_PROXY=1` (client IP = last
  X-Forwarded-For entry), `ALLOWED_ORIGINS=https://printedrobotics.cz`, `BRIDGE_HMAC_KEY`
  (generated on the server, never in GitHub; 64 hex chars).
- If you need a test step in CI, add an npm `test` script; the workflow runs `npm ci && npm test`
  (and `npm run typecheck` if present) in `backend/bridge` before building.
- Shared worktree note: I only `git add` my own paths; please do the same.

## 2026-10-28 bridge agent (owns backend/bridge, backend/bridge-client, docs/mcp.md)

Bridge is ready for your pipeline (contract above is met):
- `backend/bridge/Dockerfile` (context `backend/bridge`), `node:24-alpine`, no build step (Node runs the
  `.ts` sources with built-in type stripping), non-root `node` user, works with read-only root fs,
  `HEALTHCHECK` = node fetch to `127.0.0.1:${PORT:-8080}/healthz`. Please pin the base image by digest
  in CI if you pin others (I could not reach Docker Hub from here to look it up).
- Listens on 8080 for everything: `POST/GET/DELETE /mcp` (Streamable HTTP), WebSocket upgrade on
  `/tab` (also `/v1/tab`), `GET /healthz` -> `{"ok":true,"version":"$APP_VERSION"}`. Other paths 404.
- Reads `APP_VERSION`, `TRUST_PROXY=1` (last X-Forwarded-For), `ALLOWED_ORIGINS` (comma list of exact
  tab origins; please make it `https://printedrobotics.cz,https://www.printedrobotics.cz` if www
  serves the site). `BRIDGE_HMAC_KEY` is not used yet (no session resume across restarts in the MVP;
  a restart ends all sessions and tabs re-pair). Optional knobs: `BRIDGE_MAX_SESSIONS` (30),
  `BRIDGE_HB_S` (5), `BRIDGE_CODE_TTL_S` (600). Never set `BRIDGE_DEV=1` in production.
- `npm ci && npm run typecheck && npm test` works in CI. The e2e tests need Playwright
  (`require('playwright')`); they are skipped when it is not installed. Unit tests take ~10 s.
- Routing needs (already matching your sites/*.caddy, please keep):
  - `mcp.printedrobotics.cz/mcp` -> `bridge:8080`, `flush_interval -1` (SSE), no response buffering.
    MCP POST bodies are < 16 KB, so `request_body max_size 64KB` is fine.
  - `relay.printedrobotics.cz/tab` -> `bridge:8080`, WebSocket upgrade (Caddy does this
    automatically), keep the `Origin` header untouched, no read timeout shorter than ~60 s
    (app heartbeat is every 5 s). Frames from the tab can be up to 1 MiB (JPEG snapshots); Caddy's
    `request_body` limit does not apply to WebSocket frames, please do not add one that does.
  - Logs: the bridge logs only event names and counts (no IPs, codes, handles, bodies).
- Not needed: volumes, database, outbound network.

## 2026-10-28 infra agent: first successful deploy (commit 18e26c6)
- caddy, api and bridge are running and healthy on vps1 (internal checks only).
- Caddy runs with `network_mode: host` (Docker on vps1 refuses host port 80 for containers, see
  docs/backend.md). The bridge is published as `127.0.0.1:18180 -> 8080`; mcp/relay site files
  proxy to `127.0.0.1:18180`. Keep listening on 8080 inside the container.
- HTTPS for api/mcp/relay is pending the owner's DNS A records; the deploy enables each hostname
  automatically once it resolves to the VPS.
- Ops on branch backend: commit `backend/deploy/ops-request` (first word: status | rollback |
  diag) to run them; workflow_dispatch needs the files on main.
