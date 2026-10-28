// One HTTP server: POST /mcp (Streamable HTTP MCP), GET /healthz, WebSocket upgrade on /tab.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import type { Config } from './config.ts';
import { Registry } from './rooms.ts';
import { Relay, clientIp, isDevOrigin } from './relay.ts';
import { buildServer, requestScope } from './tools.ts';
import { log } from './log.ts';

export const MCP_PATH = '/mcp';
export const TAB_PATHS = new Set(['/tab', '/v1/tab']);
const MAX_MCP_BODY = 256 * 1024;

export interface Bridge {
  server: Server;
  registry: Registry;
  relay: Relay;
  listen(): Promise<number>;
  close(): Promise<void>;
}

function mcpOriginAllowed(cfg: Config, origin: string | undefined): boolean {
  if (!origin) return true; // non-browser MCP clients send no Origin
  if (cfg.dev && isDevOrigin(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && cfg.mcpOriginHosts.includes(u.hostname);
  } catch { return false; }
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

export function createBridge(cfg: Config): Bridge {
  const registry = new Registry(cfg);
  const relay = new Relay(cfg, registry);
  const mcp = createMcpHandler(() => buildServer(registry, cfg.version), {
    onerror: (e) => log('mcp_error', { name: e.name })
  });
  const mcpNode = toNodeHandler(mcp);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url || '/').split('?')[0];
    res.setHeader('x-content-type-options', 'nosniff');
    if (path === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) return json(res, 200, { ok: true, version: cfg.version });
    if (path === MCP_PATH) {
      if (!mcpOriginAllowed(cfg, req.headers.origin)) return json(res, 403, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Forbidden origin' } });
      const len = Number(req.headers['content-length'] || 0);
      if (len > MAX_MCP_BODY) return json(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Request too large' } });
      res.setHeader('x-accel-buffering', 'no');
      const ip = clientIp(cfg, req);
      requestScope.run({ ip }, () => {
        Promise.resolve(mcpNode(req, res)).catch(() => { if (!res.headersSent) json(res, 500, { error: 'internal' }); else res.end(); });
      });
      return;
    }
    json(res, 404, { error: 'not found' });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 120_000; // connect waits up to 60 s for the human to click Allow

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '/').split('?')[0];
    if (!TAB_PATHS.has(path)) { socket.destroy(); return; }
    relay.handleUpgrade(req, socket, head);
  });

  return {
    server, registry, relay,
    listen: () => new Promise((resolve) => server.listen(cfg.port, cfg.host, () => resolve((server.address() as any).port))),
    close: () => new Promise((resolve) => {
      registry.shutdown();
      relay.close();
      server.closeAllConnections?.();
      server.close(() => resolve());
    })
  };
}
