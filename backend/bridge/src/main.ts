import { loadConfig } from './config.ts';
import { createBridge } from './http.ts';
import { log } from './log.ts';

const cfg = loadConfig();
const bridge = createBridge(cfg);
const port = await bridge.listen();
log('listening', { port, dev: cfg.dev, version: cfg.version });

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    log('shutdown', { signal: sig });
    const t = setTimeout(() => process.exit(0), 3000);
    t.unref();
    void bridge.close().then(() => process.exit(0));
  });
}
