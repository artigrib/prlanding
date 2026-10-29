// Relay heartbeat with a manual clock: no wall-clock waits, so CI load cannot make it flaky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Relay, type RelayClock, type TabSocket } from '../src/relay.ts';
import { Registry } from '../src/rooms.ts';
import { testConfig } from './helpers.ts';

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: Record<string, any>[] = [];
  terminated = false;
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(): void { this.readyState = 3; this.emit('close'); }
  terminate(): void { this.terminated = true; this.readyState = 3; }
  fromTab(m: Record<string, unknown>): void { this.emit('message', Buffer.from(JSON.stringify({ v: 1, ...m })), false); }
  pings(): number { return this.sent.filter((m) => m.t === 'ping').length; }
}

function manualClock() {
  let t = 1_000_000;
  const ticks: (() => void)[] = [];
  const clock: RelayClock = { now: () => t, setInterval: (fn) => { ticks.push(fn); return {}; }, clearInterval: () => {} };
  /** advance by ms, firing the interval once per elapsed period */
  const advance = (ms: number, period: number) => { for (let left = ms; left > 0; left -= period) { t += Math.min(period, left); if (left >= period) ticks.forEach((f) => f()); } };
  return { clock, advance, now: () => t };
}

function setup(hbSec = 2) {
  const cfg = testConfig({ hbSec });
  const c = manualClock();
  const reg = new Registry(cfg, c.now);
  const relay = new Relay(cfg, reg, c.clock);
  const removed: string[] = [];
  const orig = reg.removeTab.bind(reg);
  reg.removeTab = (room, reason) => { removed.push(reason); orig(room, reason); };
  const ws = new FakeSocket();
  relay.attach(ws as unknown as TabSocket, '10.0.0.1');
  ws.fromTab({ t: 'hello', capabilities: { views: ['overview'], missions: ['bowl'] } });
  return { cfg, relay, reg, ws, removed, advance: (ms: number) => c.advance(ms, hbSec * 1000) };
}

test('heartbeat: a silent tab is pinged, then dropped after hbMissFactor intervals with reason "heartbeat"', () => {
  const { cfg, relay, ws, removed, advance } = setup(2);
  assert.equal(cfg.hbMissFactor, 3);
  assert.equal(relay.size, 1);
  advance(6000);                      // 3 intervals of silence: exactly at the limit, still alive
  assert.equal(ws.pings(), 3);
  assert.equal(relay.size, 1);
  assert.deepEqual(removed, []);
  advance(2000);                      // 4th interval: silence > 3 × hb
  assert.equal(relay.size, 0);
  assert.ok(ws.terminated);
  assert.deepEqual(removed, ['heartbeat']);
  relay.close();
});

test('heartbeat: a tab that answers pings stays connected', () => {
  const { relay, ws, removed, advance } = setup(2);
  for (let i = 0; i < 20; i++) { advance(2000); ws.fromTab({ t: 'pong' }); }
  assert.equal(relay.size, 1);
  assert.equal(ws.pings(), 20);
  assert.deepEqual(removed, []);
  relay.close();
});

test('debugSilence(): the relay ignores the tab and stops pinging; the heartbeat then drops it', () => {
  const { relay, ws, removed, advance } = setup(2);
  advance(2000); ws.fromTab({ t: 'pong' });
  assert.equal(relay.debugSilence(), 1);
  const before = ws.pings();
  for (let i = 0; i < 3; i++) { ws.fromTab({ t: 'pong' }); advance(2000); }   // tab still talks, relay does not listen
  assert.equal(ws.pings(), before, 'no pings to a silenced tab');
  assert.equal(relay.size, 1);
  advance(2000);
  assert.equal(relay.size, 0);
  assert.deepEqual(removed, ['heartbeat']);
  relay.close();
});
