// Unified input: keyboard (WASD / arrows + Space), gamepad, on-screen joystick + button.
// Output: { throttle: -1..1, turn: -1..1 (+ = right), fire: true once per press }.
// read(0) = single player (every device), read(1) / read(2) = local two-player split:
// P1 = WASD + Space (or F), first gamepad, touch; P2 = arrows + Enter / right Shift, second gamepad.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createInput(els, isPlaying = () => true) {
  const keys = new Set();
  const fireEdge = [false, false, false];   // per slot: edge from keyboard / touch / pad
  const padFireWas = [];
  const stick = { x: 0, y: 0, id: null };

  // only take over Space / arrows during a match, and never from a focused control
  // (so Space still activates buttons and arrows still scroll the menu)
  const interactive = e => e.target && e.target.closest && e.target.closest('button,a,input,select,textarea,[contenteditable],[tabindex]:not(canvas)');
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    keys.add(e.code);
    if (!isPlaying() || interactive(e)) return;
    if (!e.repeat) {
      if (e.code === 'Space' || e.code === 'KeyF') { fireEdge[0] = fireEdge[1] = true; }
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'ShiftRight' || e.code === 'Numpad0') { fireEdge[2] = true; if (!split.on) fireEdge[0] = true; }
    }
    if (e.code === 'Space' || e.code === 'Enter') e.preventDefault();
    if (/^Arrow/.test(e.code)) e.preventDefault();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // --- touch joystick ---------------------------------------------------
  const base = els.stick, knob = els.knob, fireBtn = els.fire;
  const R = () => base.clientWidth * 0.36;
  function stickMove(t) {
    const r = base.getBoundingClientRect();
    let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
    const max = R(), d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    stick.x = dx / max; stick.y = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  function stickEnd() { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; base.classList.remove('on'); }
  base.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (stick.id !== null) return;                       // a second finger must not steal the stick
    stick.id = e.pointerId;
    try { base.setPointerCapture(e.pointerId); } catch (_) {}
    base.classList.add('on'); stickMove(e);
  });
  base.addEventListener('pointermove', e => { if (e.pointerId === stick.id) stickMove(e); });
  const stickUp = e => { if (e.pointerId === stick.id) stickEnd(); };
  base.addEventListener('pointerup', stickUp);
  base.addEventListener('pointercancel', stickUp);
  base.addEventListener('lostpointercapture', stickUp);
  fireBtn.addEventListener('pointerdown', e => { fireEdge[0] = fireEdge[1] = true; fireBtn.classList.add('on'); e.preventDefault(); });
  const fireUp = () => fireBtn.classList.remove('on');
  fireBtn.addEventListener('pointerup', fireUp); fireBtn.addEventListener('pointercancel', fireUp);

  // test / scripting hook
  const override = { on: false, throttle: 0, turn: 0 };
  const split = { on: false };

  function read(slot = 0) {
    let th = 0, tu = 0;
    const wasd = slot !== 2, arrows = slot !== 1;
    if ((wasd && keys.has('KeyW')) || (arrows && keys.has('ArrowUp'))) th += 1;
    if ((wasd && keys.has('KeyS')) || (arrows && keys.has('ArrowDown'))) th -= 1;
    if ((wasd && keys.has('KeyD')) || (arrows && keys.has('ArrowRight'))) tu += 1;
    if ((wasd && keys.has('KeyA')) || (arrows && keys.has('ArrowLeft'))) tu -= 1;

    // gamepad: left stick (arcade), A / RB / RT = weapon
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pi = 0;
    for (const p of pads) {
      if (!p) continue;
      const idx = pi++;
      if (slot === 1 && idx !== 0) continue;
      if (slot === 2 && idx !== 1) continue;
      const dz = v => (Math.abs(v) < 0.15 ? 0 : v);
      th += -dz(p.axes[1] || 0); tu += dz(p.axes[0] || 0);
      const b = i => p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
      const padFire = b(0) || b(5) || b(7);
      const key = slot + ':' + idx;
      if (padFire && !padFireWas[key]) fireEdge[slot] = true;
      padFireWas[key] = padFire;
      if (b(12)) th += 1; if (b(13)) th -= 1; if (b(14)) tu -= 1; if (b(15)) tu += 1;
    }

    if (stick.id !== null && slot !== 2) {
      // arcade mix; slightly curved so small deflections are precise
      const sy = -stick.y, sx = stick.x;
      th += Math.sign(sy) * Math.min(1, Math.abs(sy) * 1.15) ** 1.4;
      tu += Math.sign(sx) * Math.min(1, Math.abs(sx) * 1.15) ** 1.6;
    }
    if (override.on) { th = override.throttle; tu = override.turn; }
    const fire = fireEdge[slot]; fireEdge[slot] = false;
    return { throttle: clamp(th, -1, 1), turn: clamp(tu, -1, 1), fire };
  }

  return {
    read, override, keys, split,
    pressFire(slot = 0) { fireEdge[slot] = true; if (slot === 0) fireEdge[1] = true; },
    reset() { keys.clear(); stickEnd(); fireEdge.fill(false); }
  };
}
