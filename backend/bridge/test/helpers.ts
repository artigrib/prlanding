import { loadConfig, type Config } from '../src/config.ts';
import { Registry, type Room, type TabLink } from '../src/rooms.ts';
import { setQuiet } from '../src/log.ts';

setQuiet(true);

export function testConfig(over: Partial<Config> = {}): Config {
  return loadConfig({ BRIDGE_DEV: '1', PORT: '0', HOST: '127.0.0.1' } as NodeJS.ProcessEnv, { approvalTimeoutMs: 200, ...over });
}

/** A fake tab: records what the relay sends and lets the test answer. */
export class FakeTab implements TabLink {
  sent: Record<string, any>[] = [];
  closed: [number, string] | null = null;
  room!: Room;
  autoApprove: 'allow' | 'deny' | null = null;
  onCall: ((m: Record<string, any>) => void) | null = null;
  reg: Registry;
  constructor(reg: Registry) { this.reg = reg; }
  send(msg: Record<string, unknown>): void {
    const m = msg as Record<string, any>;
    this.sent.push(m);
    if (m.t === 'pair_request' && this.autoApprove) {
      const d = this.autoApprove;
      queueMicrotask(() => this.reg.onTabMessage(this.room, { v: 1, t: 'approve', pairId: m.pairId, decision: d }));
    }
    if (m.t === 'call' && this.onCall) queueMicrotask(() => this.onCall!(m));
  }
  close(code: number, reason: string): void { this.closed = [code, reason]; }
  last(t: string): Record<string, any> | undefined { return [...this.sent].reverse().find((m) => m.t === t); }
  get code(): string { return this.last('code')?.code ?? this.last('welcome')?.code; }
  reply(id: string, structured: Record<string, unknown>, image?: unknown): void {
    this.reg.onTabMessage(this.room, { v: 1, t: 'result', id, ok: true, structured, image });
  }
  fail(id: string, code: string, details?: unknown): void {
    this.reg.onTabMessage(this.room, { v: 1, t: 'result', id, ok: false, error: { code, details } });
  }
}

export function openTab(reg: Registry, ip = '10.0.0.1', caps: Record<string, unknown> = { views: ['overview'], missions: ['bowl'] }): FakeTab {
  const tab = new FakeTab(reg);
  tab.room = reg.addTab(tab, ip, { v: 1, t: 'hello', capabilities: caps });
  return tab;
}

export async function pair(reg: Registry, tab: FakeTab, ip = '10.0.0.9'): Promise<string> {
  tab.autoApprove = 'allow';
  const { session } = await reg.connect(tab.code, ip, 'test-client');
  tab.autoApprove = null;
  return session;
}

/** Bytes with a JPEG magic number (the relay checks magic + base64 + size, not full decoding). */
export const TINY_JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]).toString('base64');
