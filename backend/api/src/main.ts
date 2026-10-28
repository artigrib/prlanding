// Entry point. Configuration via environment:
//   PORT (8081), DB_PATH (/data/events.db), APP_VERSION, ALLOWED_ORIGINS (comma list),
//   STATS_TOKEN (unset = /stats disabled), TRUST_PROXY (1 behind Caddy), FLUSH_MS (5000)
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { CounterStore } from './store.ts';
import { createApi } from './server.ts';

const env = process.env;
const port = Number(env.PORT ?? 8081);
const dbPath = env.DB_PATH ?? '/data/events.db';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

const store = new CounterStore(dbPath, Number(env.FLUSH_MS ?? 5000));
const statsToken = env.STATS_TOKEN && env.STATS_TOKEN.length >= 24 ? env.STATS_TOKEN : undefined;
const server = createApi({
  store,
  version: env.APP_VERSION ?? 'dev',
  allowedOrigins: (env.ALLOWED_ORIGINS ?? 'https://printedrobotics.cz')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  statsToken,
  trustProxy: env.TRUST_PROXY === '1',
});

server.listen(port, () => {
  // Fixed, non-sensitive log line only.
  console.log(JSON.stringify({ msg: 'listening', port, stats: Boolean(statsToken) }));
});

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => {
    store.close();
    process.exit(0);
  }, 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
