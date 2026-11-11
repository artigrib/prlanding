// Progressive unlocking in the page (HUD stage 3): locked controls stay visible, marked "od mise NN" and disabled
// (aria-disabled, so they keep their place in the tab order and say why); a click or a shortcut of a locked control
// shows a short toast "Odemkne se v misi NN". Which control unlocks when: src/unlock.js.

import { MISSIONS } from '../missions.js';
import { UNLOCK_N, reached, isUnlocked, newIn, nn } from '../unlock.js';
import { store } from './store.js';

// control → lock id, and how the "od mise NN" mark is shown
//   tag: a mark inside the button · row: a mark in the slider row (the range input is disabled) · short: " · M02"
const TARGETS = [
  ['#ux-wrist', 'wrist', 'short'],
  ['#ux-roll', 'wrist', 'row'],
  ['#ux-pitch', 'tilt', 'row'],
  ['#ux-mode [data-mode=joints]', 'joints', 'tag'],
  ['#ux-teach-b', 'teach', 'tag'],
  ['#ux-export', 'export', 'tag'],
  ['#ai-open', 'ai', 'tag'],
  ['#ai-ask-mission', 'ask', 'tag']
];

export class Locks {
  constructor(ux) {
    this.ux = ux;
    const q = new URLSearchParams(location.search);
    // ?test=1 keeps everything unlocked (existing e2e) unless the test opts in with ?lock=1
    this.off = !!ux.TEST && q.get('lock') !== '1';
    this.all = store.get('unlock-all', false) === true;
    this.extra = new Set();     // unlocked for this visit only (a shared demo link opens "Učit ukázkou")
    this.level = 1;
    // first visit with this feature: what the saved progress already reached counts as known (no "Nové:" for it)
    let seen = store.get('unlock-seen', null);
    if (!Array.isArray(seen)) { const r = reached(MISSIONS, ux.progress, null); seen = MISSIONS.map((m, i) => i + 1).filter((n) => n <= r); store.set('unlock-seen', seen); }
    this.seen = new Set(seen);
    // clicks on a locked control: the toast instead of the action (capture: before the control's own handler)
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest && e.target.closest('[data-lock]');
      if (!el || this.ok(el.dataset.lock)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.say(el.dataset.lock, true);
    }, true);
  }

  /** is the control unlocked? */
  ok(id) { return this.off || this.all || this.extra.has(id) || isUnlocked(id, this.level, false); }
  /** shortcut / action guard: true = go on; false = locked (the toast says from which mission) */
  gate(id, quiet) { if (this.ok(id)) return true; if (!quiet) this.say(id); return false; }
  say(id, force) {
    const now = performance.now();
    if (!force && id === this.saidId && now - this.saidT < 1500) return;   // a held key or a drag: one toast
    this.saidId = id; this.saidT = now;
    this.ux.panel.toast(`Odemkne se v misi ${nn(UNLOCK_N[id])}`);
  }
  setAll(on) { this.all = !!on; store.set('unlock-all', this.all); this.update(); }
  open(id) { this.extra.add(id); this.update(); }

  /** recompute from the current mission and the saved progress; mark the controls */
  update() {
    const ux = this.ux;
    this.level = reached(MISSIONS, ux.progress, ux.runner.m.id);
    for (const [sel, id, how] of TARGETS) for (const el of document.querySelectorAll(sel)) this.mark(el, id, how);
    if (ux.gizmo && ux.gizmo.lockRoll) ux.gizmo.lockRoll(!this.ok('wrist'));
    // a mode or camera that is locked now (stored from an earlier visit, or "Odemknout vše" switched off) goes back
    if (ux.mode === 'joints' && !this.ok('joints')) ux.setMode('smart', true);
    if (ux.cameras && ux.cameras.wristOn && !this.ok('wrist')) ux.setWrist(false, true);
    const b = document.getElementById('ux-unlock-b');
    if (b) b.setAttribute('aria-pressed', String(this.all));
  }

  mark(el, id, how) {
    const locked = !this.ok(id), n = nn(UNLOCK_N[id]);
    el.dataset.lock = id;
    el.classList.toggle('ux-locked', locked);
    if (el.tagName === 'INPUT') el.disabled = locked;
    else if (locked) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
    // the visible mark (part of the accessible name, except for buttons named by aria-label)
    const host = how === 'row' ? document.querySelector(`label[for="${el.id}"]`) || el.parentNode : el;
    let t = host.querySelector(':scope > .ux-lockt');
    if (!locked) { if (t) { if (t.previousSibling && t.previousSibling.nodeType === 3 && t.previousSibling.data === ' ') t.previousSibling.remove(); t.remove(); } }
    else {
      if (!t) {
        t = document.createElement('span'); t.className = 'ux-lockt mono-s';
        const before = how === 'row' ? null : el.querySelector('.ux-chev, :scope > span[aria-hidden]');
        host.insertBefore(t, before || null);
        if (how === 'row') host.insertBefore(document.createTextNode(' '), t);
      }
      const txt = how === 'short' ? `· M${n}` : `od mise ${n}`;
      if (t.textContent !== txt) t.textContent = txt;
    }
    if (el.hasAttribute('aria-label') || el.dataset.label0) {
      if (!el.dataset.label0) el.dataset.label0 = el.getAttribute('aria-label');
      el.setAttribute('aria-label', locked ? `${el.dataset.label0}, od mise ${n}` : el.dataset.label0);
    }
    if (locked) { el.title = `Odemkne se v misi ${n}`; el.dataset.lockTitle = '1'; } else if (el.dataset.lockTitle) { el.removeAttribute('title'); delete el.dataset.lockTitle; }
  }

  /** what this mission brings, once: on the first visit of the mission where it unlocks (not with "Odemknout vše").
   *  Returns the brief's line "Nové: …" (kept while the visitor stays in that mission) or null. */
  announce(m) {
    const n = parseInt(m.n, 10), what = newIn(n);
    if (this.news !== n) this.news = null;
    if (!what.length || this.off || this.all) return null;
    if (!this.seen.has(n)) {
      this.seen.add(n); store.set('unlock-seen', [...this.seen].sort((a, b) => a - b));
      this.news = n;
      clearTimeout(this.newsT);
      this.newsT = setTimeout(() => this.ux.panel.toast(`Nové: ${what.join(', ')}`, null, 5000), this.ux.started ? 700 : 2600);
    }
    return this.news === n ? `Nové: ${what.join(', ')}` : null;
  }
}
