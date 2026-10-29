# Funnel analytics: events, consent, pipeline

Privacy-first, first-party funnel analytics for printedrobotics.cz (site, SO-101 sim, arena).
One tracker (`assets/track.js`), our own endpoint (`POST https://api.printedrobotics.cz/e`), raw events
in our store (NDJSON now, ClickHouse Cloud EU later) and Amplitude (EU) for product analysis through
server-side forwarding. The browser never talks to a third party.

Source of truth for what may be collected: [`analytics/schema.json`](../../analytics/schema.json)
(versioned, `"version": 1`). The api validates every batch against it: unknown events and unknown or
invalid properties are dropped. `backend/api/src/schema.json` is a copy (the api's Docker build
context); a unit test fails when they differ.

## Ships dark: `ANALYTICS_ENABLED`

`assets/track.js` starts with `var ANALYTICS_ENABLED = false;`. While it is `false` the whole client is
inert on every page (site, sims, arena): no banner, no "Nastavení soukromí" footer link, nothing in
localStorage/sessionStorage, no requests; `prTrack(...)` calls are no-ops. The privacy pages
`/soukromi/` and `/en/privacy/` are built but `noindex,nofollow`, not in the sitemap and not linked;
the operator's missing details are HTML comments (`<!-- TODO (provozovatel) ... -->`) in
`tools/content/soukromi.{cs,en}.html`. The api `/e` endpoint deploys and simply idles.

To switch on (GDPR: the controller must be identified before anything is collected):
1. Fill every `TODO (provozovatel)` comment in `tools/content/soukromi.cs.html` / `.en.html` as
   visible text (operator name/IČO/address/contact, server provider, Amplitude retention).
2. In `tools/build.mjs` remove `draft: true` from the `soukromi` entry (indexable + sitemap), run
   `node tools/build.mjs`.
3. Set `var ANALYTICS_ENABLED = true;` in `assets/track.js`.
4. Add the Amplitude secret (below) and deploy the backend.

`tests/analytics-e2e.mjs` checks both states: the committed file (flag off → no banner, no storage,
zero requests) and the same file served with the flag flipped (all behaviour below).

## Consent

| | |
|---|---|
| Default | **Off.** Nothing is sent and no identifier exists until the visitor clicks "Povolit analytiku" / "Allow analytics". |
| Banner | `assets/consent.js` (loaded by track.js only when needed). Small, bottom, never blocks the page, CZ/EN by `<html lang>`. "Odmítnout" and "Povolit analytiku" are identical buttons side by side; nothing is pre-selected; link to the privacy page. |
| Remembered | `localStorage["pr-consent"]` = `granted` / `denied`. |
| Change | "Nastavení soukromí" / "Privacy settings" button added to every site footer, and the button on `/soukromi/` (`/en/privacy/`). Any element with `data-pr-consent` opens the settings. Declining deletes the anonymous id and the session. |
| DNT / GPC | `navigator.doNotTrack === '1'` or `navigator.globalPrivacyControl` = declined: no banner, nothing sent; the settings only explain why. |
| Before a decision | Events of the **current page** wait in memory (max 40). They are sent only if the visitor allows analytics on that same page, and discarded on "Odmítnout" or when the page closes. Nothing is stored or sent before consent. |
| Without consent | **Nothing at all** (decision: no cookieless aggregate counter either). The old identifier-free counter path still exists on the api for compatibility but no page calls it. |
| Where it is off | Any host other than `printedrobotics.cz` (HF Spaces, previews, `localhost`) unless `window.PR_TRACK_URL` is set; then the banner and tracking are completely inactive. |

Audience includes minors: plain copy, no advertising use, no profiling, no third-party scripts.

## Identifiers

- `pr-aid` (localStorage): random UUID v4, created **only** on consent, deleted on decline. Used as
  Amplitude `device_id` and ClickHouse `anon_id`. No `user_id`, no user properties.
- `pr-sid` (sessionStorage): session start in ms (Amplitude `session_id`), new after 30 min idle, per tab.
- No cookies, no fingerprinting, no IP stored anywhere.

## Events (schema v1)

Every event also carries the common properties `path` (`location.pathname`, no query or hash) and
`lang` (`cs` / `en`). Server-side additions: `country` (2 letters, only from a trusted proxy header,
see `COUNTRY_HEADER`) and `device` (`mobile` / `tablet` / `desktop`, derived from the User-Agent, which
is then dropped).

| Event | Properties | Fired from |
|---|---|---|
| `page_view` | `ref_domain` (referrer host only), `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | every page with track.js |
| `sim_load_start` | `sim` (`so101`/`arena`/…) | sim/so101/app.js, arena main.js |
| `sim_loaded` | `sim`, `ms`, `detail` (`plain`/`objects`) | when the sim is interactive |
| `sim_load_failed` | `sim`, `reason` (`no_webgl`/`no_wasm`/`error`/`context_lost`) | load errors |
| `mission_start` | `mission` | first arm movement of a fresh attempt (MissionRunner.start) |
| `mission_win` | `mission`, `stars` 0–3, `seconds`, `assisted` (planner or replay solved it) | ux.js win() |
| `hint_used` | `mission`, `level` (1 = HUD hint after 20 s, 2 = mission card) | hint buttons |
| `solution_shown` | `mission` | the planner plays the solution (hint, demo button, shortcut) |
| `mode_changed` | `mode` (`smart`/`joints`) | user switched control mode |
| `teach_recorded` | `mission` | a teach-by-demonstration recording was kept |
| `demo_shared` | `mission` | share link for a demonstration created |
| `ai_panel_open` | – | "Připojit AI" panel opened (once per page) |
| `ai_paired` | – | an AI assistant paired with the tab |
| `ai_tool_call` | `tool` | **sampled**: first call of each tool per page view |
| `arena_match_start` | `robot`, `opponent`, `mode` | arena round starts |
| `arena_match_end` | `result` (`win`/`loss`/`draw`, player 1's view), `kind` (`ko`/`decision`), `seconds`, `mode` | arena round ends |
| `replay_shared` | `method` (`file`/`link`) | arena replay saved or shared |
| `kit_view` | `kit` | `/sada/<id>/`, `/en/kit/<id>/` (automatic) |
| `waitlist_submit` | `interest` (ticked option ids, e.g. `so101,ai`) | waitlist form sent successfully |
| `school_lead_submit` | – | school pilot form sent successfully |
| `cta_click` | `id` | any element with `data-cta="…"` or `data-track="…"` |

Value rules (from `schema.json`): ids are slugs `^[a-z0-9][a-z0-9_-]{0,39}$`, enums are closed,
integers have ranges, `path` allows only `[A-Za-z0-9/._-]`. A value that does not fit is dropped,
never truncated into something else. **Never** add names, e-mails, free text, precise geo or
anything a visitor types.

`ai_paired` / `ai_tool_call` are emitted client-side (the tab sees pairing and tool activity): the
bridge has neither the consent state nor the anonymous id, and it has no outbound network by design.

### Adding an event

1. Add it to `analytics/schema.json` (snake_case, `description`, typed props), copy the file to
   `backend/api/src/schema.json`, bump `version` only for breaking changes.
2. Call it: `window.prTrack && prTrack(name, props)` or, in modules,
   `import { track } from './analytics.js'` (sim/so101) / `./ui/track.js` (arena). Calls made before
   track.js loaded are queued in `window.prTrackQ`.
3. Document it in the table above and, if it belongs to a funnel, in amplitude.md.

## Client: `assets/track.js`

- < 3 KB gzipped (consent UI in `assets/consent.js`, loaded only for the banner/settings).
- Batches events (flush after 3 s, at 20 events, and on `visibilitychange: hidden` / `pagehide`),
  sends with `navigator.sendBeacon` (text/plain, no CORS preflight), `fetch(keepalive)` fallback.
- Body: `{"v":1,"aid":"<uuid>","sid":<ms>,"events":[{"e":"mission_win","t":<ms>,"n":<seq>,"p":{…}}]}`.
- Loaded by `assets/app.js` on every site page and by a `<script defer>` on the sim pages.
- Endpoint: `https://api.printedrobotics.cz/e` on printedrobotics.cz; elsewhere set
  `window.PR_TRACK_URL` before track.js runs (local dev: `http://127.0.0.1:8081/e` with the api
  started with `ALLOWED_ORIGINS=http://127.0.0.1:8123`).

## Server: `backend/api` `POST /e`

- CORS / Origin check: only `ALLOWED_ORIGINS` (production: `https://printedrobotics.cz`).
- Rate limit per IP in memory (60 requests/min, 6000/min overall); the IP is never written anywhere.
- Body ≤ 16 KB, ≤ 25 events; bad envelope → 400; known bots → 204 and ignored.
- Validation (`src/analytics/validate.ts`), then the same records go to every sink
  (`src/analytics/sinks.ts`) and to the daily counters behind `/stats` (which also reports sink stats).

| Sink | On when | Notes |
|---|---|---|
| NDJSON | always | `/data/events/events-YYYY-MM-DD.ndjson` on the `api_data` volume, append-only, UTC days, files older than 760 days (≈ 25 months) deleted. Interim raw store and backfill source. |
| ClickHouse | `CLICKHOUSE_URL` + `CLICKHOUSE_USER` + `CLICKHOUSE_PASSWORD` | HTTPS insert `FORMAT JSONEachRow` (async insert), 500 rows / 10 s, retries 429/5xx with exponential backoff, drops on other 4xx (the NDJSON file still has them). DDL: [`analytics/clickhouse.sql`](../../analytics/clickhouse.sql) (MergeTree family, monthly partitions, TTL 25 months). |
| Amplitude | `AMPLITUDE_API_KEY` | `https://api.eu.amplitude.com/2/httpapi`, ≤ 10 events per request, `device_id` = anonymous id, `insert_id` for dedupe, no `ip` field (the request comes from our server, so Amplitude never sees a visitor IP), `country` only when known. 429 → pause 30 s; 5xx → backoff; 400/413 → drop. |

Logs contain fixed messages with counts and HTTP status codes only: never keys, payloads, ids or IPs.
Queues are bounded (5000 events per HTTP sink; oldest dropped first).

## Owner setup

GitHub → **Settings → Secrets and variables → Actions**. Use **Environment secrets** of the
`production` environment (or repository secrets); the deploy job reads both. Empty / missing = that
sink stays off. After adding them, re-run **Deploy backend** (branch `backend`); the run shows
`analytics sinks: ndjson[, clickhouse][, amplitude]`.

| Name | Kind | Value |
|---|---|---|
| `AMPLITUDE_API_KEY` | secret | API key of the Amplitude project "default" (EU data center) |
| `CLICKHOUSE_URL` | secret | `https://<service>.<region>.clickhouse.cloud:8443` (later, once the ClickHouse Cloud org exists) |
| `CLICKHOUSE_USER` | secret | insert-only user from analytics/clickhouse.sql |
| `CLICKHOUSE_PASSWORD` | secret | its password |
| `ANALYTICS_COUNTRY_HEADER` | variable (optional) | name of a country header the edge proxy sets, e.g. `cf-ipcountry`; leave unset if none |

Values reach the server on the SSH stdin (base64), are written to `analytics.env` (mode 600) next to
the generated `secrets.env`, and are passed only to the api container. Allowed characters: printable
ASCII without spaces, quotes or backslashes.

Recommended in Amplitude: project settings → disable IP address and location collection / ask
Support to drop IPs (belt and braces; we never send a visitor IP), and set the data retention to
match the privacy page.

## Privacy page

`/soukromi/` and `/en/privacy/` (sources `tools/content/soukromi.{cs,en}.html`, built by
`tools/build.mjs`). Processors listed: our server, ClickHouse Cloud EU (planned), Amplitude EU, plus
Google Fonts and the forms' Google Apps Script outside analytics. `TODO (provozovatel)` markers are
left for the operator's company details, hosting provider, Amplitude retention and the contact for
data-subject requests. Do not fill them with guesses.

## Tests

- `backend/api`: `npm test` (validator, sinks with mock HTTP servers, `/e` end to end).
- `tests/analytics-e2e.mjs` (Playwright, needs `npm ci` at the root): consent off → zero requests to
  `/e`; consent on → events arrive (site, SO-101 sim, arena); DNT/GPC → no banner, zero requests;
  axe-core on the banner (CZ + EN, 390 px and 1440 px).
