// "Připojit AI" panel: pairing code, setup for Claude Code / Claude apps, Allow prompt, connection state,
// STOP / Odpojit (also as a bar over the 3D view), and a human-readable log of what the AI does.
// Loaded lazily by src/agent/index.js. Relay data is rendered with textContent only, never as HTML.

import { createAgentBridge, BridgeError } from '../../../../backend/bridge-client/agent-bridge.js';
import { MISSIONS } from '../missions.js';
import { t } from '../i18n/index.js';

export const MCP_URL = 'https://mcp.printedrobotics.cz/mcp';
export const RELAY_URL = 'wss://relay.printedrobotics.cz/tab';
export const ADD_CMD = `claude mcp add --transport http printedrobotics ${MCP_URL}`;
const DOCS = 'https://github.com/artigrib/prlanding/blob/main/docs/mcp.md';
const LOG_MAX = 40;
const MAX_TRIES = 3;                 // failed link attempts before the error state
const BACKOFF_MS = 1500, BACKOFF_CAP_MS = 15000;
/** No welcome from the relay within this time = the attempt failed. ?ai_timeout= (ms, 500-8000) for tests. */
const CONNECT_TIMEOUT_MS = Math.max(500, Math.min(8000, +new URLSearchParams(location.search).get('ai_timeout') || 8000));

/** ?relay= is honoured only for a relay on this machine (local development and the end-to-end test). */
export function relayUrl(search = location.search) {
  const want = new URLSearchParams(search).get('relay');
  if (!want) return RELAY_URL;
  try {
    const u = new URL(want);
    if (/^wss?:$/.test(u.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return u.href;
  } catch (e) { /* ignore */ }
  return RELAY_URL;
}

const JOINT = { shoulder_pan: 'otočení základny', shoulder_lift: 'rameno', elbow_flex: 'loket', wrist_flex: 'náklon zápěstí', wrist_roll: 'rotace zápěstí' };
const VIEW = { overview: 'přehled', top: 'shora', side: 'z boku', wrist: 'ze zápěstí' };
const ERR = {
  OUT_OF_LIMITS: 'mimo rozsah kloubu, nic se nepohnulo', WORKSPACE_VIOLATION: 'mimo bezpečný prostor, nic se nepohnulo',
  UNREACHABLE: 'tam ruka nedosáhne', IK_NO_SOLUTION: 'tuhle polohu ruka nezvládne', ESTOP_ACTIVE: 'zablokováno tlačítkem STOP',
  BUSY: 'ruka je zaneprázdněná', TIMEOUT: 'vypršel čas', CANCELLED: 'zrušeno', INVALID_ARGUMENT: 'neplatné zadání',
  UNKNOWN_MISSION: 'neznámá mise', TAB_HIDDEN: 'karta je na pozadí', NOT_SUPPORTED: 'nepodporováno', RENDER_UNAVAILABLE: 'obraz není k dispozici'
};
const n1 = (v) => (Math.round(v * 10) / 10).toLocaleString(document.documentElement.lang === 'en' ? 'en' : 'cs-CZ');

/** One line of plain language for a tool call (the log the person reads). */
export function describe(tool, a = {}) {
  switch (tool) {
    case 'move_joints': {
      const parts = Object.entries(a.joints_deg || {}).map(([j, v]) => `${t(JOINT[j] || j)} ${a.relative && v > 0 ? '+' : ''}${n1(v)}°`);
      if (a.gripper_pct != null) parts.push(`${t('chapadlo')} ${a.relative && a.gripper_pct > 0 ? '+' : ''}${n1(a.gripper_pct)} %`);
      return t('Pohyb kloubů: {what}', { what: parts.join(', ') });
    }
    case 'move_to': {
      const p = a.pose || {};
      return t('Přesun chapadla na x {x}, y {y}, z {z} mm', { x: n1(p.x_mm), y: n1(p.y_mm), z: n1(p.z_mm) });
    }
    case 'set_gripper':
      return a.gripper_pct === 'open' ? t('Otevřít chapadlo') : a.gripper_pct === 'close' ? t('Zavřít chapadlo') : t('Chapadlo na {p} %', { p: n1(a.gripper_pct) });
    case 'home': return a.pose === 'zero' ? t('Všechny klouby na 0°') : t('Návrat do výchozí polohy');
    case 'stop': return t('Zastavit');
    case 'snapshot': return t('Snímek kamery ({view})', { view: t(VIEW[a.view] || VIEW.overview) });
    case 'get_state': return t('Zjišťuje polohu ruky');
    case 'get_scene': return t('Prohlíží si scénu');
    case 'list_missions': return t('Čte seznam misí');
    case 'start_mission': {
      const m = MISSIONS.find((x) => x.id === a.mission_id);
      return m ? t('Spouští misi {n}: {title}', { n: m.n, title: t(m.title) }) : t('Spouští misi');
    }
    case 'check_mission': return t('Kontroluje misi');
    case 'reset_scene': return t('Vrací scénu na začátek');
    default: return tool;
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function copyBtn(get, label = 'Kopírovat') {
  const b = el('button', 'ai-copy', t(label));
  b.type = 'button';
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(get()); b.textContent = t('Zkopírováno'); }
    catch (e) { b.textContent = t('Označte a zkopírujte ručně'); }
    setTimeout(() => { b.textContent = t(label); }, 1600);
  });
  return b;
}

export function mountAgentPanel(root, { api, ux, button }) {
  root.textContent = '';
  // ---------- status + connect ----------
  const status = el('p', 'ai-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const dot = el('i', 'ai-dot'); dot.setAttribute('aria-hidden', 'true');
  const statusText = el('span', null, '');
  status.append(dot, statusText);
  const btnConnect = el('button', 'btn btn-act ai-connect', t('Získat kód pro připojení')); btnConnect.type = 'button';
  const btnRetryNow = el('button', 'ux-link', t('Zkusit hned')); btnRetryNow.type = 'button'; btnRetryNow.hidden = true;
  const errBox = el('div', 'ai-err'); errBox.hidden = true; errBox.setAttribute('data-testid', 'agent-error');
  const btnRetry = el('button', 'btn btn-act', t('Zkusit znovu')); btnRetry.type = 'button'; btnRetry.setAttribute('data-testid', 'agent-retry');
  errBox.append(el('p', 'ink2', t('Simulace funguje dál i bez něj. Zkuste to za chvíli; když to nepůjde ani pak, napište nám.')), btnRetry);

  // ---------- code ----------
  const codeBox = el('div', 'ai-codebox'); codeBox.hidden = true;
  const codeLbl = el('p', 'mono', t('Kód pro připojení'));
  const codeRow = el('div', 'ai-coderow');
  const codeEl = el('output', 'ai-code'); codeEl.setAttribute('data-testid', 'agent-code');
  codeRow.append(codeEl, copyBtn(() => codeEl.textContent));
  const codeExp = el('p', 'mono-s muted ai-exp');
  const btnNew = el('button', 'ux-link', t('Nový kód')); btnNew.type = 'button';
  codeBox.append(codeLbl, codeRow, codeExp, btnNew);

  // ---------- setup instructions ----------
  const setup = el('div', 'ai-setup'); setup.hidden = true;
  const seg = el('div', 'ux-seg ai-seg'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', t('Kde používáte Clauda'));
  const tabCode = el('button', null, 'Claude Code'), tabApp = el('button', null, t('Claude (aplikace a web)'));
  for (const b of [tabCode, tabApp]) { b.type = 'button'; b.setAttribute('role', 'radio'); seg.append(b); }
  const say = () => t('Připoj se k simulaci SO-101, kód {code}', { code: codeEl.textContent || 'XXXX-XXXX' });
  const sayCode = el('code', 'ai-say');
  const sayCode2 = el('code', 'ai-say');
  const stepsCode = el('ol', 'ai-steps');
  {
    const li1 = el('li'); li1.append(el('span', null, t('Jednou přidejte server (v terminálu):')), el('code', 'ai-cmd', ADD_CMD), copyBtn(() => ADD_CMD));
    const li2 = el('li'); li2.append(el('span', null, t('Napište Claudovi:')), sayCode, copyBtn(say));
    const li3 = el('li', null, t('Tady v simulaci klikněte na Povolit.'));
    stepsCode.append(li1, li2, li3);
  }
  const stepsApp = el('ol', 'ai-steps'); stepsApp.hidden = true;
  {
    const li1 = el('li', null, t('V Claudovi otevřete Nastavení → Konektory → Přidat vlastní konektor.'));
    const li2 = el('li'); li2.append(el('span', null, t('Název printedrobotics, adresa (bez přihlášení):')), el('code', 'ai-cmd', MCP_URL), copyBtn(() => MCP_URL));
    const li3 = el('li'); li3.append(el('span', null, t('V novém chatu konektor zapněte a napište:')), sayCode2, copyBtn(say));
    const li4 = el('li', null, t('Tady v simulaci klikněte na Povolit.'));
    stepsApp.append(li1, li2, li3, li4);
  }
  const showTab = (app) => {
    tabCode.setAttribute('aria-checked', String(!app)); tabApp.setAttribute('aria-checked', String(app));
    stepsCode.hidden = app; stepsApp.hidden = !app;
  };
  tabCode.addEventListener('click', () => showTab(false)); tabApp.addEventListener('click', () => showTab(true));
  showTab(false);
  setup.append(seg, stepsCode, stepsApp);

  // ---------- controls + log ----------
  const ctl = el('div', 'ai-ctl');
  const btnStop = el('button', 'btn ai-stop', 'STOP'); btnStop.type = 'button'; btnStop.setAttribute('data-testid', 'agent-stop');
  const btnOff = el('button', 'btn btn-o', t('Odpojit')); btnOff.type = 'button'; btnOff.setAttribute('data-testid', 'agent-disconnect');
  ctl.append(btnStop, btnOff); ctl.hidden = true;
  const logBox = el('div', 'ai-logbox'); logBox.hidden = true;
  const logH = el('p', 'mono', t('Co AI dělá'));
  const log = el('ol', 'ai-log'); log.setAttribute('data-testid', 'agent-log'); log.setAttribute('aria-live', 'polite');
  const logEmpty = el('p', 'mono-s muted', t('Zatím nic. Každý příkaz AI se tu objeví.'));
  logBox.append(logH, logEmpty, log);
  const foot = el('p', 'mono-s muted ai-foot');
  const docs = el('a', null, t('Jak to funguje')); docs.href = DOCS; docs.target = '_blank'; docs.rel = 'noopener';
  foot.append(document.createTextNode(t('Jen simulace: AI nemůže ovládat skutečnou ruku. Server zprávy jen přeposílá a nic neukládá.') + ' '), docs);
  root.append(status, btnRetryNow, btnConnect, errBox, codeBox, setup, ctl, logBox, foot);

  // ---------- bar over the 3D view (always visible while an AI link exists) ----------
  const stage = document.querySelector('.stage');
  const bar = el('div', 'ai-bar'); bar.hidden = true; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', t('Ovládání přes AI'));
  const barText = el('span', 'ai-bar-t');
  const barStop = el('button', 'ai-bar-stop', 'STOP'); barStop.type = 'button'; barStop.setAttribute('data-testid', 'agent-bar-stop');
  const barOff = el('button', 'ai-bar-off', t('Odpojit')); barOff.type = 'button';
  const barDot = el('i', 'ai-dot'); barDot.setAttribute('aria-hidden', 'true');
  bar.append(barDot, barText, barStop, barOff);
  stage.append(bar);

  // ---------- Allow prompt ----------
  const ask = el('div', 'ux-modal ai-ask'); ask.hidden = true;
  const askIn = el('div', 'ux-modal-in'); askIn.setAttribute('role', 'alertdialog'); askIn.setAttribute('aria-modal', 'true'); askIn.setAttribute('aria-labelledby', 'ai-ask-h');
  const askH = el('h2'); askH.id = 'ai-ask-h';
  const askP = el('p', 'ink2', t('Pokud jste právě zadali kód do svého AI asistenta, povolte to. Jinak zamítněte, kód se tím zneplatní. AI uvidí a ovládá jen tuto simulaci, ne skutečnou ruku. Kdykoli ji zastavíte tlačítkem STOP.'));
  const askT = el('p', 'mono-s muted');
  const askRow = el('div', 'ux-row2');
  const allow = el('button', 'btn btn-act', t('Povolit')); allow.type = 'button'; allow.setAttribute('data-testid', 'agent-allow');
  const deny = el('button', 'btn btn-o', t('Zamítnout')); deny.type = 'button'; deny.setAttribute('data-testid', 'agent-deny');
  askRow.append(allow, deny);
  askIn.append(askH, askP, askT, askRow); ask.append(askIn);
  document.body.append(ask);

  // ---------- activity log ----------
  const pendingLog = [];
  function logStart(tool) {
    const li = el('li');
    const time = el('time', 'mono-s', new Date().toLocaleTimeString(document.documentElement.lang === 'en' ? 'en-GB' : 'cs-CZ'));
    const txt = el('span', 'ai-log-t', describe(tool, {}));
    const res = el('b', 'ai-log-r', '…');
    li.append(time, txt, res);
    log.prepend(li);
    while (log.children.length > LOG_MAX) log.lastChild.remove();
    logEmpty.hidden = true;
    const e = { tool, li, txt, res, t0: performance.now(), described: false, status: null };
    pendingLog.push(e);
    return e;
  }
  function logArgs(tool, args) {
    const e = pendingLog.find((x) => x.tool === tool && !x.described);
    if (e) { e.described = true; e.txt.textContent = describe(tool, args); }
    return e;
  }
  function logEnd(tool, ok, code) {
    const i = pendingLog.findIndex((x) => x.tool === tool);
    if (i < 0) return;
    const [e] = pendingLog.splice(i, 1);
    const s = n1((performance.now() - e.t0) / 1000);
    if (ok && e.status && e.status !== 'completed') { e.res.textContent = '■ ' + t('zastaveno'); e.li.className = 'warn'; return; }
    e.res.textContent = ok ? `✓ ${s} s` : '✕ ' + t(ERR[code] || code || 'chyba');
    e.li.className = ok ? 'ok' : 'err';
  }

  // the relay handler: the agent API, errors as BridgeError, arguments into the log
  const handler = {};
  for (const k of ['info', 'getState', 'getScene', 'moveJoints', 'moveTo', 'setGripper', 'home', 'stop', 'snapshot', 'listMissions', 'startMission', 'checkMission', 'resetScene', 'onLinkLost']) {
    handler[k] = async (args, ctx) => {
      const entry = ctx && ctx.tool ? logArgs(ctx.tool, args || {}) : null;
      try {
        const r = await api[k](args, ctx || {});
        if (entry && r && r.status) entry.status = r.status;
        return r;
      } catch (e) {
        if (e && typeof e.code === 'string' && !(e instanceof BridgeError)) throw new BridgeError(e.code, e.details);
        throw e;
      }
    };
  }

  // ---------- state ----------
  // view: idle | connecting | retry | error (the panel's own link handling) or the bridge's waiting | pairing | paired.
  // The bridge never reconnects by itself (reconnect: false): a failed or silent link is counted here, retried with a
  // capped backoff, and after MAX_TRIES the panel stops in a clear error state with "Zkusit znovu".
  let state = 'idle', clientName = '', code = null, expTimer = 0, decide = null, askTimer = 0;
  let wanted = false, failing = false, attempts = 0, connTimer = 0, retryTimer = 0, retryAt = 0, cdTimer = 0;
  const STATUS = {
    idle: 'Nepřipojeno', connecting: 'Připojuji se k serveru…', waiting: 'Čeká na AI asistenta',
    pairing: 'AI asistent žádá o připojení', paired: 'Simulaci ovládá: {name}',
    retry: 'Server neodpovídá. Zkusím to znovu za {s} s (pokus {n} z {max}).',
    error: 'Server pro připojení AI teď není dostupný.'
  };
  function render() {
    root.dataset.state = state;
    const est = api.estop, paired = state === 'paired';
    const left = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    statusText.textContent = t(STATUS[state], { name: clientName || 'AI', s: left, n: attempts + 1, max: MAX_TRIES }) + (est ? ' · ' + t('STOP je zapnutý') : '');
    btnConnect.hidden = state !== 'idle';
    errBox.hidden = state !== 'error';
    btnRetryNow.hidden = state !== 'retry';
    codeBox.hidden = setup.hidden = !(state === 'waiting' || state === 'pairing');
    ctl.hidden = state === 'idle' || state === 'error';
    btnStop.hidden = !(paired || est);                    // STOP only once a session exists (or to release a latched one)
    btnOff.textContent = paired || state === 'waiting' || state === 'pairing' ? t('Odpojit') : t('Zrušit');
    ctl.classList.toggle('one', btnStop.hidden);
    logBox.hidden = !log.children.length && !paired;
    bar.hidden = !(paired || est);                        // the bar over the 3D view only while an AI drives the arm
    bar.dataset.state = state;
    barText.textContent = paired ? t('AI ovládá ruku: {name}', { name: clientName || 'AI' }) : t('STOP je zapnutý');
    barOff.hidden = !paired;
    for (const b of [btnStop, barStop]) {
      b.textContent = est ? t('Uvolnit STOP') : 'STOP';
      b.setAttribute('aria-pressed', String(est));
    }
    root.classList.toggle('estop', est); bar.classList.toggle('estop', est);
    btnNew.hidden = state !== 'waiting';
    sayCode.textContent = sayCode2.textContent = say();
  }
  function clearTimers() { clearTimeout(connTimer); clearTimeout(retryTimer); clearInterval(cdTimer); }
  function start() {
    clearTimers();
    wanted = true; state = 'connecting'; render();
    connTimer = setTimeout(() => fail('timeout'), CONNECT_TIMEOUT_MS);
    bridge.connect();
  }
  /** The link failed (refused, timed out or dropped): retry with backoff, or stop in the error state. */
  function fail() {
    clearTimers();
    failing = true; bridge.disconnect(); failing = false;
    code = null; clearInterval(expTimer); closeAsk();
    attempts++;
    if (attempts >= MAX_TRIES) { state = 'error'; render(); return; }
    const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_MS * 2 ** (attempts - 1));
    retryAt = Date.now() + delay; state = 'retry';
    retryTimer = setTimeout(start, delay);
    cdTimer = setInterval(render, 1000);
    render();
  }
  function stopAll() {
    wanted = false; clearTimers(); attempts = 0;
    failing = true; bridge.disconnect(); failing = false;
    code = null; clearInterval(expTimer); state = 'idle'; render();
  }
  function tickExp() {
    if (!code) { codeExp.textContent = ''; return; }
    const left = Math.max(0, Math.min(600, Math.round((code.expiresAt - Date.now()) / 1000)));
    codeExp.textContent = left > 0 ? t('Kód platí ještě {t} a jde použít jen jednou.', { t: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }) : t('Kód vypršel. Vyžádejte si nový.');
  }

  const bridge = createAgentBridge({
    url: relayUrl(),
    handler,
    client: { app: 'so101-sim', ver: '1' },
    reconnect: false,
    ui: {
      onState(s) {
        if (s.clientName) clientName = s.clientName;
        if (s.state !== 'pairing') closeAsk();
        if (s.state === 'connecting') return;               // the panel shows its own connecting / retry state
        if (s.state === 'idle' || s.state === 'offline') {   // the link closed: refused, dropped or by us
          if (failing || !wanted) return;
          return fail();
        }
        clearTimeout(connTimer); attempts = 0;               // the relay answered
        state = s.state;
        render();
      },
      onCode(c) {
        code = c; codeEl.textContent = c.code;
        clearInterval(expTimer); tickExp(); expTimer = setInterval(tickExp, 1000);
        render();
      },
      onPairRequest(req) { openAsk(req); },
      onPairCancel() { closeAsk(); },
      onPaired({ clientName: n }) {
        clientName = n; code = null; clearInterval(expTimer);
        ux.panel.toast(t('AI asistent je připojen. Zastavíte ho tlačítkem STOP.'));
        if (ux.onboarding && ux.onboarding.active()) ux.onboarding.finish();
      },
      onUnpaired() { ux.panel.toast(t('AI asistent byl odpojen.')); },
      onActivity(a) { if (a.phase === 'start') logStart(a.tool); else logEnd(a.tool, a.ok, a.code); }
    }
  });

  function openAsk(req) {
    decide = req;
    askH.textContent = t('{name} chce ovládat tuto simulaci', { name: req.clientName });
    ask.hidden = false;
    const upd = () => { const s = Math.max(0, Math.round((req.expiresAt - Date.now()) / 1000)); askT.textContent = t('Bez odpovědi se za {s} s zamítne.', { s }); };
    upd(); clearInterval(askTimer); askTimer = setInterval(upd, 1000);
    allow.focus();
  }
  function closeAsk() { ask.hidden = true; decide = null; clearInterval(askTimer); }
  allow.addEventListener('click', () => { const d = decide; closeAsk(); if (d) d.allow(); });
  deny.addEventListener('click', () => { const d = decide; closeAsk(); if (d) d.deny(); });
  ask.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); deny.click(); } });

  const toggleStop = () => { api.setEstop(!api.estop); if (api.estop) ux.panel.toast(t('STOP: AI nemůže hýbat rukou, dokud ho neuvolníte.'), 'err'); };
  btnStop.addEventListener('click', toggleStop);
  barStop.addEventListener('click', toggleStop);
  const off = () => { api.stop(); stopAll(); };
  btnOff.addEventListener('click', off);
  barOff.addEventListener('click', off);
  btnConnect.addEventListener('click', () => { attempts = 0; start(); });
  btnRetry.addEventListener('click', () => { attempts = 0; start(); });
  btnRetryNow.addEventListener('click', () => start());
  btnNew.addEventListener('click', () => bridge.rotateCode());
  api.on('estop', render);

  const panel = {
    bridge,
    open() {
      root.hidden = false; button.setAttribute('aria-expanded', 'true');
      if (state === 'idle') { attempts = 0; start(); }
      render();
      root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    collapse() { root.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  };
  window.__so101Agent = panel;   // tests and debugging (state only; motion goes through window.so101)
  render();
  return panel;
}
