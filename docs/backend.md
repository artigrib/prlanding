# printedrobotics.cz backend

The website stays static on GitHub Pages. A small backend runs on one VPS ("vps1") in Docker, next to
other unrelated containers that it never touches. Everything is deployed by GitHub Actions from the
`backend` branch. This repo is public, so this page holds no server details (no IPs, ports or paths
of other projects) and the workflows print only short status annotations.

## Architecture

```
Browser (printedrobotics.cz on GitHub Pages)
   │  POST https://api.printedrobotics.cz/e        (assets/track.js, sendBeacon)
   │  WSS  wss://relay.printedrobotics.cz/...      (bridge, later)
   ▼
vps1 ── docker compose project "printedrobotics" (own network "printedrobotics_web")
   caddy :80/:443   Let's Encrypt only, automatic HTTPS, no access log
     api.printedrobotics.cz   ─▶ api:8081     (backend/api)
     mcp.printedrobotics.cz   ─▶ bridge:8080  (backend/bridge, MCP Streamable HTTP)
     relay.printedrobotics.cz ─▶ bridge:8080  (backend/bridge, WebSocket relay)
   api      Node 24 + TypeScript, SQLite file in volume printedrobotics_api_data
   bridge   placeholder until backend/bridge/Dockerfile exists (compose profile "bridge")
```

Only Caddy publishes ports. Every container is read-only, drops all capabilities, has
`no-new-privileges`, memory/CPU/PID limits, `restart: unless-stopped` and json-file logs
rotated at 10 MB × 3.

### api (`backend/api`)

| Endpoint | What it does |
|---|---|
| `GET /health` (also `/healthz`) | `{"ok":true,"version":"<git sha>"}` |
| `POST /e` | Counts one event. Body `{"e":"<name>"}` or the bare name, max 256 bytes. Names: `sim_start sim_success sim_cta arena_start arena_end arena_cta mcp_connect mcp_tool kit_view`. Returns 204. |
| `OPTIONS /e` | CORS preflight. |
| `GET /stats?days=30` | Daily aggregates. Needs `Authorization: Bearer <STATS_TOKEN>`. |

Privacy design:
- No cookies are read or set, no identifiers, no user agent, no referrer, no URL. The database
  holds only `(day, event, count)`.
- The client IP is used only in RAM for the rate limit (60 events/min per IP, 6000/min overall);
  the map is cleared every minute and never written anywhere. Caddy has no access log.
- CORS and the `Origin` check allow only `https://printedrobotics.cz`. Requests without that
  Origin get 403.
- Counts are buffered in memory and written to SQLite every 5 s (and on shutdown).

`/stats` decision: it is reachable over HTTPS but protected by a bearer token. The token is
generated on the server at the first deploy (`openssl rand`) and never passes through GitHub.
To read it, the owner logs in to the server and looks at `secrets.env` in the deploy directory,
then for example:

```sh
curl -s -H "Authorization: Bearer $STATS_TOKEN" "https://api.printedrobotics.cz/stats?days=30"
```

If the token is empty or shorter than 24 characters, `/stats` answers 404.

Storage upgrade path: SQLite (`node:sqlite`, no native modules) is enough for daily counters. When
the teacher dashboard, progress sync or the leaderboard arrive, add a `postgres` service on an
internal-only network in the same compose project and move `daily_counts` there (a single
`INSERT ... SELECT` export). Keep the same HTTP API.

Local development:

```sh
cd backend/api
npm ci
npm test            # node:test, 11 tests
npm run typecheck   # tsc, no emit
DB_PATH=./dev.db STATS_TOKEN=dev-token-dev-token-dev-token npm start
```

Node 24 runs the `.ts` sources directly (type stripping), so the runtime image has no
`node_modules`.

## How to deploy

Push to branch `backend` with changes under `backend/api/`, `backend/bridge/`, `backend/deploy/`
or the workflow file, or run **Actions → Deploy backend → Run workflow**.

`.github/workflows/deploy-backend.yml`:
1. **test**: api typecheck and tests; bridge tests if `backend/bridge/Dockerfile` exists;
   `caddy validate` with all sites enabled; `docker compose config`.
2. **build**: builds images and pushes them to GHCR with the job's `GITHUB_TOKEN`
   (`ghcr.io/artigrib/prlanding-api:<sha>`, `ghcr.io/artigrib/prlanding-bridge:<sha>`).
   Images are deployed by digest, never `latest`.
3. **deploy** (environment `production`):
   - DNS gate: for `api`, `mcp` and `relay` it checks whether the A record already points at the
     VPS. Only those hostnames get a Caddy site block, so Caddy never asks Let's Encrypt for a
     name that does not point here. `mcp` and `relay` also wait for the bridge image. The
     annotations list which names are enabled and which are pending.
   - SSH with the pinned host key (`VPS_KNOWN_HOSTS`, `StrictHostKeyChecking=yes`).
   - Uploads `backend/deploy/` and runs `remote-deploy.sh` on the server, which:
     aborts if less than 3 GB is free; generates server-side secrets once; logs in to GHCR with
     the short-lived job token in a throw-away docker config, pulls by digest and logs out;
     saves the previous release; runs `docker compose up -d --wait`; reloads Caddy; checks
     `http://api:8081/health` from inside the Caddy container (and the bridge `/healthz`) and
     compares the version with the commit; on failure restores the previous release, config and
     images, and the job fails. On success it removes old `ghcr.io/artigrib/prlanding-*` images,
     keeping the current and previous release. It never prunes anything else.
   - External check of `https://<name>.printedrobotics.cz/health` for enabled names.

Why GHCR and not building on the server: the build runs on GitHub's machines (no CPU or disk
use on a VPS with little free disk), the server only pulls a small Alpine-based image, and the
previous image stays on the server for an instant rollback. GHCR packages created by a workflow
start private; the deploy logs in on the server with the job's short-lived token, so this works
whether or not the package is made public. No registry credential is stored on the server.

Why the GHCR images are not built on push to `main`: the backend lives only on branch `backend`.

## How to roll back

- Automatic: a deploy whose health check fails restores the previous release by itself.
- Manual: **Actions → Rollback backend → Run workflow → action `rollback`**. It switches to the
  previous release kept on the server and health-checks it. `status` shows the current release and
  the state of our containers.
- To go back to any older commit: re-run its **Deploy backend** run (Actions → the run → Re-run
  all jobs), or revert the commit on `backend` and push.

## What the owner must do

1. **DNS A records** (at the DNS provider of printedrobotics.cz): `api`, `mcp` and `relay` → the
   VPS IPv4 address. Today they fall through to the GitHub Pages wildcard. Do not add AAAA
   records unless they point at the VPS. After adding them, re-run **Deploy backend**; the DNS
   gate enables HTTPS for each name that resolves to the VPS. Optional: CAA record on the apex
   `0 issue "letsencrypt.org"` (Caddy is configured for Let's Encrypt only, and GitHub Pages also
   uses Let's Encrypt).
2. **Firewall**: if a host firewall (ufw, provider firewall) is active, allow TCP 80, TCP 443 and
   UDP 443. Let's Encrypt needs port 80 or 443 reachable from the internet.
3. **Pin the SSH host key** (`VPS_KNOWN_HOSTS` secret). Until it is set, each run trusts the key it
   sees (trust on first use) and prints the SHA256 fingerprints as notices. On your own computer:

   ```sh
   ssh-keyscan -p <port> <vps-host> 2>/dev/null > vps_known_hosts
   ssh-keygen -lf vps_known_hosts      # compare with the fingerprints in the workflow notices
                                       # and, if possible, with the provider console
   ```

   Then **Settings → Secrets and variables → Actions → New repository secret**, name
   `VPS_KNOWN_HOSTS`, value = the contents of `vps_known_hosts`. From then on all workflows use
   `StrictHostKeyChecking=yes` and fail if the key changes.
4. **Protect deployments** (recommended). The API for environments is not reachable from the
   agent session, so do it by hand: **Settings → Environments → `production`** (it is created by
   the first deploy run) →
   - **Required reviewers**: add yourself (leave "Prevent self-review" off).
   - **Deployment branches and tags**: "Selected branches and tags" → add `backend`.
   - Optionally move `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` from
     repository secrets to environment secrets of `production`, so they are released only to
     approved deploy jobs (then also add them to an environment used by `vps-report.yml`, or keep
     repository copies for it).
   After this, every deploy waits for your approval in the Actions UI.
5. Later (from the security plan): replace root SSH with a `deploy` user and a forced-command key,
   disable root login, and pin `caddy`/`node` base images by digest (Dependabot can keep them
   fresh).

## Wiring the analytics beacon into the site (not done yet)

`assets/track.js` is on branch `backend` only and no page loads it. To turn it on (on `main`):

1. Add before `</body>` of the pages that should count events:

   ```html
   <script src="/assets/track.js" defer></script>
   ```

2. Send events:
   - declaratively on links/buttons: `<a href="/sada.html" data-track="sim_cta">`
   - from code: `window.prTrack && window.prTrack('sim_start', { once: true })`
   Suggested places: `sim_start`/`sim_success`/`sim_cta` in `sim/so101`, `arena_start`/
   `arena_end`/`arena_cta` in `sim/arena`, `kit_view` on `sada.html`, `mcp_connect`/`mcp_tool` from
   the bridge client.
3. If a page has a Content Security Policy, add `https://api.printedrobotics.cz` to `connect-src`.
4. Mention in the privacy notice: aggregate, identifier-free counters; no cookies; requests from
   browsers with Global Privacy Control or Do Not Track are not sent.

The beacon is fire-and-forget: if the api is down, blocked or DNS is missing, nothing happens and
the page is unaffected. It only works once `api.printedrobotics.cz` has HTTPS (step 1 above).
