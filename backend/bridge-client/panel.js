// Optional default UI for the AgentBridge: connect button, pairing code, Allow/Deny prompt,
// status and Disconnect. Uses textContent only (relay data is never parsed as HTML).
// The sim page may use this as-is or build its own UI on the same hooks.
//
//   import { mountPanel } from './panel.js';
//   const panel = mountPanel(document.getElementById('ai'), { url, handler });

import { createAgentBridge } from './agent-bridge.js';

export const MCP_URL = 'https://mcp.printedrobotics.cz/mcp';
export const ADD_CMD = `claude mcp add --transport http so101 ${MCP_URL}`;

const T = {
  connect: 'Připojit AI asistenta',
  connecting: 'Připojuji…',
  offline: 'Spojení přerušeno, zkouším znovu…',
  waiting: 'Řekněte asistentovi: „Připoj se k simulaci SO-101, kód',
  pairing: 'chce ovládat tuto simulaci.',
  allow: 'Povolit',
  deny: 'Zamítnout',
  paired: 'Simulaci ovládá',
  disconnect: 'Odpojit AI',
  newCode: 'Nový kód',
  once: 'Jednou nainstalujte:',
  copy: 'Kopírovat'
};

function el(tag, attrs = {}, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

export function mountPanel(root, opts) {
  root.textContent = '';
  root.classList.add('agent-panel');
  const status = el('p', { 'data-testid': 'agent-status', role: 'status', 'aria-live': 'polite' });
  const codeBox = el('p', { 'data-testid': 'agent-code-box', hidden: '' });
  const codeEl = el('strong', { 'data-testid': 'agent-code', class: 'agent-code' });
  codeBox.append(el('span', {}, T.waiting + ' '), codeEl, el('span', {}, '“'));
  const install = el('p', { class: 'agent-install', hidden: '' });
  const cmd = el('code', {}, ADD_CMD);
  const copy = el('button', { type: 'button' }, T.copy);
  copy.addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(ADD_CMD).catch(() => {}); });
  install.append(el('span', {}, T.once + ' '), cmd, document.createTextNode(' '), copy);

  const ask = el('div', { 'data-testid': 'agent-ask', role: 'alertdialog', hidden: '' });
  const askText = el('p');
  const allow = el('button', { type: 'button', 'data-testid': 'agent-allow' }, T.allow);
  const deny = el('button', { type: 'button', 'data-testid': 'agent-deny' }, T.deny);
  ask.append(askText, allow, deny);

  const btnConnect = el('button', { type: 'button', 'data-testid': 'agent-connect' }, T.connect);
  const btnNew = el('button', { type: 'button', 'data-testid': 'agent-newcode', hidden: '' }, T.newCode);
  const btnOff = el('button', { type: 'button', 'data-testid': 'agent-disconnect', hidden: '' }, T.disconnect);
  root.append(status, codeBox, install, ask, btnConnect, btnNew, btnOff);

  let decide = null;
  allow.addEventListener('click', () => { if (decide) decide.allow(); ask.hidden = true; });
  deny.addEventListener('click', () => { if (decide) decide.deny(); ask.hidden = true; });

  const bridge = createAgentBridge({
    ...opts,
    ui: {
      onState({ state, clientName }) {
        root.dataset.state = state;
        btnConnect.hidden = state !== 'idle';
        btnOff.hidden = state === 'idle';
        btnNew.hidden = state !== 'waiting';
        codeBox.hidden = state !== 'waiting';
        install.hidden = state !== 'waiting';
        if (state !== 'pairing') ask.hidden = true;
        status.textContent =
          state === 'connecting' ? T.connecting :
          state === 'offline' ? T.offline :
          state === 'paired' ? `${T.paired}: ${clientName || 'AI'}` : '';
        if (opts.ui && opts.ui.onState) opts.ui.onState({ state, clientName });
      },
      onCode({ code }) { codeEl.textContent = code; },
      onPairRequest(req) {
        decide = req;
        askText.textContent = `${req.clientName} ${T.pairing}`;
        ask.hidden = false;
        allow.focus();
      },
      onPairCancel() { ask.hidden = true; decide = null; },
      onActivity(a) { if (opts.ui && opts.ui.onActivity) opts.ui.onActivity(a); }
    }
  });
  btnConnect.addEventListener('click', () => bridge.connect());
  btnNew.addEventListener('click', () => bridge.rotateCode());
  btnOff.addEventListener('click', () => { if (bridge.state === 'paired') bridge.revoke(); else bridge.disconnect(); });
  return bridge;
}
