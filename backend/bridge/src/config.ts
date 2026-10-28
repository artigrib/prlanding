// Runtime configuration. Everything comes from environment variables; nothing here is secret.

export interface Config {
  port: number;
  host: string;
  /** Exact origins allowed to open the /tab WebSocket (browser-enforced Origin header). */
  tabOrigins: string[];
  /** Dev mode: also allow http(s)://localhost|127.0.0.1|[::1] on any port for /tab and /mcp. */
  dev: boolean;
  /** Origin hostnames accepted on /mcp when an Origin header is present (absent = non-browser client, allowed). */
  mcpOriginHosts: string[];
  /** Take the client IP from the right-most X-Forwarded-For entry (set when running behind Caddy). */
  trustProxy: boolean;
  version: string;

  // pairing
  codeTtlMs: number;
  codeMaxFails: number;
  approvalTimeoutMs: number;
  // sessions
  maxSessions: number;
  maxRooms: number;
  maxTabsPerIp: number;
  sessionIdleMs: number;
  sessionMaxMs: number;
  tombstoneMs: number;
  // heartbeat (seconds between pings; link is dead after hbMissFactor intervals of silence)
  hbSec: number;
  hbMissFactor: number;
  // limits
  maxFrameBytes: number;
  maxArgsBytes: number;
  maxInflightPerSession: number;
  snapshotDeadlineMs: number;
  idempotencyTtlMs: number;
  // rate limits
  connectPerMin: number;
  connectFailsPer10Min: number;
  connectCooldownMs: number;
  callsPerSec: number;
  callsBurst: number;
  snapshotsPerSec: number;
  tabMsgsPerSec: number;
}

const num = (env: NodeJS.ProcessEnv, k: string, d: number): number => {
  const v = env[k];
  if (v == null || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`config: ${k} must be a number`);
  return n;
};
const list = (env: NodeJS.ProcessEnv, k: string, d: string[]): string[] =>
  env[k] ? env[k]!.split(',').map((s) => s.trim()).filter(Boolean) : d;

export function loadConfig(env: NodeJS.ProcessEnv = process.env, over: Partial<Config> = {}): Config {
  const dev = env.BRIDGE_DEV === '1';
  const tabOrigins = list(env, 'BRIDGE_TAB_ORIGINS', ['https://printedrobotics.cz', 'https://www.printedrobotics.cz']);
  return {
    port: num(env, 'PORT', 8080),
    host: env.HOST || '0.0.0.0',
    tabOrigins,
    dev,
    mcpOriginHosts: list(env, 'BRIDGE_MCP_ORIGIN_HOSTS', ['printedrobotics.cz', 'www.printedrobotics.cz', 'mcp.printedrobotics.cz', 'claude.ai']),
    trustProxy: env.BRIDGE_TRUST_PROXY === '1',
    version: env.BRIDGE_VERSION || 'dev',

    codeTtlMs: num(env, 'BRIDGE_CODE_TTL_S', 600) * 1000,
    codeMaxFails: 5,
    approvalTimeoutMs: num(env, 'BRIDGE_APPROVAL_TIMEOUT_S', 60) * 1000,
    maxSessions: num(env, 'BRIDGE_MAX_SESSIONS', 30),
    maxRooms: num(env, 'BRIDGE_MAX_ROOMS', 300),
    maxTabsPerIp: num(env, 'BRIDGE_MAX_TABS_PER_IP', 30),
    sessionIdleMs: num(env, 'BRIDGE_SESSION_IDLE_S', 2 * 3600) * 1000,
    sessionMaxMs: num(env, 'BRIDGE_SESSION_MAX_S', 8 * 3600) * 1000,
    tombstoneMs: 30 * 60 * 1000,
    hbSec: num(env, 'BRIDGE_HB_S', 5),
    hbMissFactor: 3,
    maxFrameBytes: 1024 * 1024,
    maxArgsBytes: 16 * 1024,
    maxInflightPerSession: 4,
    snapshotDeadlineMs: num(env, 'BRIDGE_SNAPSHOT_DEADLINE_S', 8) * 1000,
    idempotencyTtlMs: 120 * 1000,
    connectPerMin: 20,
    connectFailsPer10Min: 10,
    connectCooldownMs: 15 * 60 * 1000,
    callsPerSec: 5,
    callsBurst: 10,
    snapshotsPerSec: 1,
    tabMsgsPerSec: 50,
    ...over
  };
}
