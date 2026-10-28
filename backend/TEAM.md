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
