// Unified input: keyboard (WASD / arrows + Space), gamepad, on-screen joystick + button.
// Output: { throttle: -1..1, turn: -1..1 (+ = right), fire: true once per press }.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createInput(els, isPlaying = () => true) {
  const keys = new Set();
  let firePressed = false;      // edge from keyboard / touch / pad
  let padFireWas = false;
  const stick = { x: 0, y: 0, id: null };

  // only take over Space / arrows during a match, and never from a focused control
  // (so Space still activates buttons and arrows still scroll the menu)
  const interactive = e => e.target && e.target.closest && e.target.closest('button,a,input,select,textarea,[contenteditable],[tabindex]:not(canvas)');
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    keys.add(e.code);
    if (!isPlaying() || interactive(e)) return;
    if (e.code === 'Space') { if (!e.repeat) firePressed = true; e.preventDefault(); }
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
  fireBtn.addEventListener('pointerdown', e => { firePressed = true; fireBtn.classList.add('on'); e.preventDefault(); });
  const fireUp = () => fireBtn.classList.remove('on');
  fireBtn.addEventListener('pointerup', fireUp); fireBtn.addEventListener('pointercancel', fireUp);

  // test / scripting hook
  const override = { on: false, throttle: 0, turn: 0 };

  function read() {
    let th = 0, tu = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) th += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) th -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) tu += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) tu -= 1;

    // gamepad: left stick (arcade), A / RB / RT = weapon
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let padFire = false;
    for (const p of pads) {
      if (!p) continue;
      const dz = v => (Math.abs(v) < 0.15 ? 0 : v);
      th += -dz(p.axes[1] || 0); tu += dz(p.axes[0] || 0);
      const b = i => p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5);
      if (b(0) || b(5) || b(7)) padFire = true;
      if (b(12)) th += 1; if (b(13)) th -= 1; if (b(14)) tu -= 1; if (b(15)) tu += 1;
    }
    if (padFire && !padFireWas) firePressed = true;
    padFireWas = padFire;

    if (stick.id !== null) {
      // arcade mix; slightly curved so small deflections are precise
      const sy = -stick.y, sx = stick.x;
      th += Math.sign(sy) * Math.min(1, Math.abs(sy) * 1.15) ** 1.4;
      tu += Math.sign(sx) * Math.min(1, Math.abs(sx) * 1.15) ** 1.6;
    }
    if (override.on) { th = override.throttle; tu = override.turn; }
    const fire = firePressed; firePressed = false;
    return { throttle: clamp(th, -1, 1), turn: clamp(tu, -1, 1), fire };
  }

  return { read, override, keys, pressFire() { firePressed = true; }, reset() { keys.clear(); stickEnd(); firePressed = false; } };
}
