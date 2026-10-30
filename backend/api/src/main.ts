// Entry point. Configuration via environment:
//   PORT (8081), DB_PATH (/data/events.db), APP_VERSION, ALLOWED_ORIGINS (comma list),
//   STATS_TOKEN (unset = /stats disabled), TRUST_PROXY (1 behind Caddy), FLUSH_MS (5000)
// Analytics (docs/analytics/events.md):
//   ANALYTICS_DIR (/data/events, NDJSON, always on), ANALYTICS_RETENTION_DAYS (760),
//   COUNTRY_HEADER (unset = no country; e.g. cf-ipcountry when the edge proxy sets it),
//   CLICKHOUSE_URL + CLICKHOUSE_USER + CLICKHOUSE_PASSWORD (+ CLICKHOUSE_DATABASE, CLICKHOUSE_TABLE): sink on when set,
//   AMPLITUDE_API_KEY (+ AMPLITUDE_ENDPOINT, default EU): forwarder on when set.
// Forge (src/forge.ts): on when FORGE_ENABLED=1 (set by the deploy only when the worker runs) and
//   FORGE_INVITE_TOKENS has at least one valid "label:sha256hex" entry. FORGE_JOBS_DIR (/jobs),
//   FORGE_DAILY_USD (5), FORGE_JOBS_PER_DAY (5 per token), FORGE_MAX_QUEUED (5).
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CounterStore } from './store.ts';
import { createApi } from './server.ts';
import { loadSchema } from './analytics/validate.ts';
import { sinksFromEnv } from './analytics/sinks.ts';
import { Forge, parseTokens } from './forge.ts';

const env = process.env;
const port = Number(env.PORT ?? 8081);
const dbPath = env.DB_PATH ?? '/data/events.db';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

const store = new CounterStore(dbPath, Number(env.FLUSH_MS ?? 5000));
const schema = loadSchema();
const sinks = sinksFromEnv(env);
const countryHeader = (env.COUNTRY_HEADER ?? '').trim().toLowerCase() || undefined;
const statsToken = env.STATS_TOKEN && env.STATS_TOKEN.length >= 24 ? env.STATS_TOKEN : undefined;
const forgeTokens = parseTokens(env.FORGE_INVITE_TOKENS);
let forge: Forge | undefined;
if (env.FORGE_ENABLED === '1' && forgeTokens.length > 0) {
  process.umask(0o007); // forge files are shared with the worker through the group, never world-readable
  try {
    forge = new Forge({
      jobsDir: env.FORGE_JOBS_DIR ?? '/jobs',
      tokens: forgeTokens,
      allowedOrigins: (env.ALLOWED_ORIGINS ?? 'https://printedrobotics.cz').split(',').map((s) => s.trim()).filter(Boolean),
      dailyUsd: Number(env.FORGE_DAILY_USD ?? 5) || 5,
      jobsPerTokenPerDay: Number(env.FORGE_JOBS_PER_DAY ?? 5) || 5,
      maxQueued: Number(env.FORGE_MAX_QUEUED ?? 5) || 5,
    });
  } catch {
    forge = undefined; // job volume not writable: the forge stays off, the rest of the api runs
  }
}
const server = createApi({
  store,
  version: env.APP_VERSION ?? 'dev',
  allowedOrigins: (env.ALLOWED_ORIGINS ?? 'https://printedrobotics.cz')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  statsToken,
  trustProxy: env.TRUST_PROXY === '1',
  analytics: { schema, sinks, countryHeader },
  forge,
});

server.listen(port, () => {
  // Fixed, non-sensitive log line only.
  console.log(
    JSON.stringify({ msg: 'listening', port, stats: Boolean(statsToken), schema: schema.version, sinks: sinks.map((x) => x.name), forge: Boolean(forge), forge_tokens: forge ? forgeTokens.length : 0 }),
  );
});

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  const flushed = Promise.allSettled(sinks.map((x) => x.close()));
  server.close(() => {
    void flushed.then(() => {
      store.close();
      process.exit(0);
    });
  });
  setTimeout(() => {
    store.close();
    process.exit(0);
  }, 8000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
