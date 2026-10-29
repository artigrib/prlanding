// AgentBridge: connects a simulation tab to the printedrobotics.cz MCP relay so an MCP client
// (Claude Code etc.) can drive it. Plain ES module, no dependencies.
//
//   import { createAgentBridge } from './agent-bridge.js';
//   const bridge = createAgentBridge({ url: 'wss://relay.printedrobotics.cz/tab', handler, ui });
//   bridge.connect();
//
// The tab is the only safety authority: every relayed call is re-validated here against the
// generated schemas, motions are serialised (BUSY / preempt), deadlines and cancels stop motion,
// and a lost heartbeat stops motion and calls handler.onLinkLost(). See README.md for the
// handler interface the page must implement.

import schemas from './schemas.js';
import { validate } from './validate.js';

export const PROTOCOL = 1;
export const DEFAULT_URL = 'wss://relay.printedrobotics.cz/tab';

/** Throw this from handler methods to return a structured error to the agent. */
export class BridgeError extends Error {
  constructor(code, details) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

/** MCP tool name -> handler method name. */
export const HANDLER_METHODS = Object.freeze({
  get_state: 'getState',
  get_scene: 'getScene',
  move_joints: 'moveJoints',
  move_to: 'moveTo',
  set_gripper: 'setGripper',
  home: 'home',
  stop: 'stop',
  snapshot: 'snapshot',
  list_missions: 'listMissions',
  start_mission: 'startMission',
  check_mission: 'checkMission',
  reset_scene: 'resetScene'
});

const MOTION = new Set(schemas.motion_tools);

function b64FromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function toImage(res) {
  if (res.blob) return { mimeType: res.blob.type || res.mimeType, data: b64FromBytes(new Uint8Array(await res.blob.arrayBuffer())) };
  if (typeof res.dataUrl === 'string') {
    const m = /^data:(image\/(?:jpeg|png));base64,(.*)$/.exec(res.dataUrl);
    if (!m) throw new BridgeError('RENDER_UNAVAILABLE', { reason: 'bad_data_url' });
    return { mimeType: m[1], data: m[2] };
  }
  if (typeof res.data === 'string') return { mimeType: res.mimeType, data: res.data };
  throw new BridgeError('RENDER_UNAVAILABLE');
}

/**
 * @param {object} opts
 * @param {string} [opts.url]        relay WebSocket URL (default wss://relay.printedrobotics.cz/tab)
 * @param {object} opts.handler      page-provided handler (see README.md)
 * @param {object} [opts.ui]         optional UI hooks: onState, onCode, onPairRequest, onPairCancel, onPaired, onUnpaired, onActivity
 * @param {boolean} [opts.reconnect] reconnect with backoff after a dropped link (default true)
 * @param {object} [opts.client]     {app, ver} reported in hello
 */
export function createAgentBridge(opts) {
  const url = opts.url || DEFAULT_URL;
  const handler = opts.handler;
  const ui = opts.ui || {};
  const WS = opts.WebSocketImpl || globalThis.WebSocket;
  const reconnect = opts.reconnect !== false;
  if (!handler) throw new Error('createAgentBridge: handler is required');

  let ws = null;
  let state = 'idle';            // idle | connecting | waiting | pairing | paired | offline
  let wanted = false;            // user wants to be connected
  let hbSec = 5, hbTimer = null, lastRx = 0, backoff = 500, retryTimer = null;
  let code = null, pending = null, clientName = null;
  const calls = new Map();       // call id -> { ac, tool }
  let motion = null;             // { id, ac, done: Promise }

  const emit = (name, arg) => { try { ui[name] && ui[name](arg); } catch (e) { console.error(e); } };
  const setState = (s, info) => { state = s; emit('onState', { state: s, ...info }); };
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ v: PROTOCOL, ts: Date.now(), ...m })); };

  async function haltMotion(reason) {
    if (motion) { motion.ac.abort(reason); motion = null; }
    try { if (handler.stop) await handler.stop({ reason }, { signal: new AbortController().signal, tool: 'stop' }); } catch (e) { /* best effort */ }
  }

  function linkDown(reason) {
    for (const c of calls.values()) c.ac.abort(reason);
    calls.clear();
    if (state === 'paired' || motion) {
      haltMotion(reason);
      try { handler.onLinkLost && handler.onLinkLost(reason); } catch (e) { console.error(e); }
    }
    if (pending) { clearTimeout(pending.timer); emit('onPairCancel', { pairId: pending.pairId }); pending = null; }
    clientName = null;
    code = null;
  }

  function open() {
    clearTimeout(retryTimer);
    setState('connecting');
    let sock;
    try { sock = new WS(url); } catch (e) { return scheduleRetry(); }
    ws = sock;
    lastRx = Date.now();
    sock.onopen = async () => {
      let caps = {};
      try { caps = (handler.info ? await handler.info() : {}) || {}; } catch (e) { caps = {}; }
      send({
        t: 'hello',
        client: { app: (opts.client && opts.client.app) || 'so101-sim', ver: (opts.client && opts.client.ver) || '0' },
        mode: 'sim',
        capabilities: { views: caps.views || ['overview'], missions: caps.missions || [] }
      });
      backoff = 500;
    };
    sock.onmessage = (ev) => {
      lastRx = Date.now();
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || m.v !== PROTOCOL || typeof m.t !== 'string') return;
      onMessage(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      stopHeartbeat();
      linkDown('link_closed');
      if (wanted && reconnect) { setState('offline'); scheduleRetry(); } else setState('idle');
    };
    sock.onerror = () => { /* onclose follows */ };
  }

  function scheduleRetry() {
    const d = Math.min(30000, backoff) * (0.7 + Math.random() * 0.6);
    backoff = Math.min(30000, backoff * 2);
    retryTimer = setTimeout(() => { if (wanted) open(); }, d);
  }

  function startHeartbeat() {
    stopHeartbeat();
    hbTimer = setInterval(() => {
      if (Date.now() - lastRx > hbSec * 3000) {
        // relay silent: treat as lost, stop motion, reconnect
        const s = ws; ws = null;
        stopHeartbeat();
        linkDown('heartbeat');
        try { s && s.close(4001, 'heartbeat'); } catch (e) { /* ignore */ }
        if (wanted && reconnect) { setState('offline'); scheduleRetry(); } else setState('idle');
        return;
      }
      send({ t: 'ping' });
    }, hbSec * 1000);
  }
  function stopHeartbeat() { clearInterval(hbTimer); hbTimer = null; }

  function onMessage(m) {
    switch (m.t) {
      case 'welcome':
        hbSec = Math.max(1, Math.min(60, Number(m.hb) || 5));
        startHeartbeat();
        // falls through
      case 'code':
        code = { code: String(m.code || '').slice(0, 16), expiresAt: Number(m.codeExp) || 0 };
        if (state !== 'paired') setState('waiting', code);
        emit('onCode', code);
        return;
      case 'ping': send({ t: 'pong' }); return;
      case 'pong': return;
      case 'pair_request': return onPairRequest(m);
      case 'pair_cancel':
        if (pending && pending.pairId === m.pairId) { clearTimeout(pending.timer); pending = null; emit('onPairCancel', { pairId: m.pairId }); if (state === 'pairing') setState('waiting', code); }
        return;
      case 'paired':
        clientName = String((m.client && m.client.name) || 'MCP client').slice(0, 32);
        code = null;
        setState('paired', { clientName });
        emit('onPaired', { clientName });
        return;
      case 'unpaired':
        linkDown('unpaired');
        setState('waiting', {});
        emit('onUnpaired', { reason: String(m.reason || '').slice(0, 32) });
        return;
      case 'call': return void onCall(m);
      case 'cancel': {
        const c = calls.get(m.id);
        if (c) c.ac.abort('cancelled');
        return;
      }
      case 'bye': return; // server restart: onclose + reconnect follows
      default: return;
    }
  }

  function onPairRequest(m) {
    if (pending || state === 'paired') return send({ t: 'approve', pairId: m.pairId, decision: 'deny' });
    const pairId = String(m.pairId || '');
    const name = String((m.client && m.client.name) || 'MCP client').slice(0, 32);
    const ms = Math.max(1000, Math.min(120000, Number(m.expiresMs) || 60000));
    const decide = (allow) => {
      if (!pending || pending.pairId !== pairId) return;
      clearTimeout(pending.timer);
      pending = null;
      send({ t: 'approve', pairId, decision: allow ? 'allow' : 'deny' });
      if (!allow) setState('waiting', code || {});
    };
    pending = { pairId, timer: setTimeout(() => decide(false), ms) };
    setState('pairing', { clientName: name });
    if (!ui.onPairRequest) return decide(false); // never auto-allow
    emit('onPairRequest', { pairId, clientName: name, expiresAt: Date.now() + ms, allow: () => decide(true), deny: () => decide(false) });
  }

  function reply(id, ok, payload) { send({ t: 'result', id, ok, ...payload }); }
  function replyError(id, e) {
    const code = e && typeof e.code === 'string' ? e.code : 'TAB_ERROR';
    const details = e && e.details && typeof e.details === 'object' ? e.details : undefined;
    if (!(e instanceof BridgeError)) console.error('[agent-bridge]', e);
    reply(id, false, { error: { code, details } });
  }

  async function onCall(m) {
    const id = String(m.id || '');
    const tool = String(m.tool || '');
    const args = m.args && typeof m.args === 'object' ? m.args : {};
    if (state !== 'paired') return replyError(id, new BridgeError('NOT_CONNECTED'));
    const schema = schemas.tools[tool];
    const method = HANDLER_METHODS[tool];
    if (!schema || !method) return replyError(id, new BridgeError('NOT_SUPPORTED', { tool: tool.slice(0, 32) }));
    const bad = validate(schema, args);
    if (bad) return replyError(id, new BridgeError('INVALID_ARGUMENT', bad));
    const fn = handler[method];
    if (typeof fn !== 'function') return replyError(id, new BridgeError('NOT_SUPPORTED', { tool }));

    const ac = new AbortController();
    calls.set(id, { ac, tool });
    const deadline = setTimeout(() => ac.abort('deadline'), Math.max(500, Math.min(60000, Number(m.deadlineMs) || 10000)));
    emit('onActivity', { tool, phase: 'start' });
    const isMotion = MOTION.has(tool);
    try {
      if (tool === 'stop') {
        if (motion) { motion.ac.abort('stopped'); motion = null; }
      } else if (isMotion) {
        if (motion) {
          if (!args.preempt) throw new BridgeError('BUSY', { running: motion.tool });
          motion.ac.abort('preempted');
          await motion.done.catch(() => {});
        }
      }
      const run = (async () => {
        const res = await fn.call(handler, args, { signal: ac.signal, tool, requestId: args.request_id });
        if (ac.signal.aborted) {
          const why = ac.signal.reason;
          if (why === 'deadline') throw new BridgeError('TIMEOUT');
          if (why === 'cancelled' || why === 'link_closed' || why === 'heartbeat' || why === 'unpaired') throw new BridgeError('CANCELLED', { reason: String(why) });
          // preempted/stopped motions report their own (stopped) status from the handler
        }
        return res;
      })();
      if (isMotion) motion = { id, ac, tool, done: run };
      let res;
      try { res = await run; } finally {
        if (motion && motion.id === id) motion = null;
        if (isMotion && ac.signal.aborted && (ac.signal.reason === 'deadline' || ac.signal.reason === 'cancelled')) await haltMotion(ac.signal.reason);
      }
      res = res && typeof res === 'object' ? res : {};
      let image;
      if (tool === 'snapshot') {
        image = await toImage(res);
        res = { view: res.view, width: res.width, height: res.height, sim_time_s: res.sim_time_s };
      }
      const structured = { ...res, meta: { backend: 'sim', ...(res.meta || {}) } };
      reply(id, true, image ? { structured, image } : { structured });
      emit('onActivity', { tool, phase: 'end', ok: true });
    } catch (e) {
      replyError(id, e);
      emit('onActivity', { tool, phase: 'end', ok: false, code: e && e.code });
    } finally {
      clearTimeout(deadline);
      calls.delete(id);
    }
  }

  return {
    connect() { wanted = true; if (!ws) open(); },
    /** Close the link entirely (stops motion, ends any session). */
    disconnect() {
      wanted = false;
      clearTimeout(retryTimer);
      const s = ws; ws = null;
      stopHeartbeat();
      linkDown('user_disconnect');
      try { s && s.close(1000, 'bye'); } catch (e) { /* ignore */ }
      setState('idle');
    },
    /** End the AI session but keep the link (a new code is issued). */
    revoke() { if (state === 'paired') { send({ t: 'revoke' }); linkDown('revoked'); } },
    /** Ask for a fresh pairing code. */
    rotateCode() { if (state === 'waiting') send({ t: 'rotate' }); },
    get state() { return state; },
    get code() { return code; },
    get clientName() { return clientName; }
  };
}
