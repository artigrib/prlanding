// Mock "models" for CI: scripted tool-call policies behind the same chat() interface as the OpenRouter client.
// They read only what a real model reads (the tool messages in the conversation), so the harness, graders and
// metrics are tested end to end without network or keys. Usage is computed from message sizes (chars / 4) and a
// fixed fake price, so token and $ metrics are deterministic.
//   mock/solve-bowl  solves mission 01 (the same plan as sim/so101/tests/agent-script.mjs)
//   mock/fail        one refused motion (OUT_OF_LIMITS), one aimless move, then task_complete: a failure
//   mock/wave        waves N times with run_trajectory (N read from the prompt)
//   mock/square      traces the square from the prompt with run_trajectory jaw-tip waypoints
//   mock/idle        calls task_complete at once
export const MOCK_PRICE = { in_per_m: 1, out_per_m: 4 };
const wrap90 = (a) => { a = ((a % 90) + 90) % 90; return a >= 45 ? a - 90 : a; };
const call = (name, args = {}) => ({ calls: [{ name, args }] });

function* solveBowl() {
  let [r] = yield call('get_scene', { include: ['objects'] });
  const cube = r.objects.find((o) => o.id === 'cube'), bowl = r.objects.find((o) => o.id === 'bowl');
  if (!cube || !bowl) { yield call('task_complete', { summary: 'No cube or bowl here.' }); return; }
  const c = cube.pose, b = bowl.pose;
  [r] = yield call('move_to', { pose: { x_mm: c.x_mm, y_mm: c.y_mm, z_mm: 90 }, gripper_pct: 70 });
  const roll = r.final.goal_deg.wrist_roll + wrap90(cube.yaw_deg - r.final.tool.jaw_yaw_deg);
  yield call('move_to', { pose: { x_mm: c.x_mm, y_mm: c.y_mm, z_mm: 60, roll_deg: roll } });
  yield call('move_to', { pose: { x_mm: c.x_mm, y_mm: c.y_mm, z_mm: Math.max(10, c.z_mm - 2), roll_deg: roll }, duration_s: 1.5 });
  yield call('set_gripper', { gripper_pct: 'close' });
  yield call('move_to', { pose: { x_mm: c.x_mm, y_mm: c.y_mm, z_mm: 100, roll_deg: roll }, duration_s: 1.5 });
  yield call('move_to', { pose: { x_mm: b.x_mm, y_mm: b.y_mm, z_mm: 100, roll_deg: roll }, duration_s: 2 });
  yield call('move_to', { pose: { x_mm: b.x_mm, y_mm: b.y_mm, z_mm: 45, roll_deg: roll }, duration_s: 1.2 });
  yield call('set_gripper', { gripper_pct: 'open' });
  yield call('move_to', { pose: { x_mm: b.x_mm, y_mm: b.y_mm, z_mm: 110 } });
  for (let i = 0; i < 3; i++) {
    [r] = yield call('check_mission');
    if (r.mission && r.mission.state === 'success') break;
    yield call('move_joints', { joints_deg: { shoulder_pan: r.mission ? 0 : 0 }, duration_s: 1 });   // let time pass
  }
  yield call('task_complete', { summary: 'Cube carried into the bowl.' });
}

function* fail() {
  yield call('get_state');
  yield call('move_joints', { joints_deg: { shoulder_pan: 130 } });       // refused: OUT_OF_LIMITS (safety violation)
  yield call('move_to', { pose: { x_mm: 200, y_mm: 120, z_mm: 150 } });
  yield { text: 'I think the task is done.', calls: [{ name: 'task_complete', args: { summary: 'Moved the arm.' } }] };
}

function* wave(prompt) {
  const n = +(/wave hello (\d+) times/.exec(prompt) || [0, 3])[1];
  const wps = [{ joints_deg: { shoulder_pan: 0, shoulder_lift: -40, elbow_flex: 20, wrist_flex: 0, wrist_roll: 0 }, duration_s: 1.5 }];
  for (let i = 0; i < n; i++) wps.push({ joints_deg: { wrist_flex: 35 }, duration_s: 0.6 }, { joints_deg: { wrist_flex: -35 }, duration_s: 0.6 });
  wps.push({ joints_deg: { wrist_flex: 0 }, duration_s: 0.5 });
  const [r] = yield call('run_trajectory', { waypoints: wps });
  if (!r.ok) yield call('get_state');
  yield call('task_complete', { summary: `Waved ${n} times.` });
}

function* square(prompt) {
  const num = (k) => +(new RegExp(k + ' = (-?\\d+) mm').exec(prompt) || [])[1];
  const z = num('z'), cx = num('x'), cy = num('y');
  const side = +(/side is (\d+) mm/.exec(prompt) || [])[1], yaw = +(/rotated (-?\d+) degrees/.exec(prompt) || [])[1] * Math.PI / 180;
  const h = side / 2, c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (x, y) => ({ x_mm: Math.round((cx + c * x - s * y) * 10) / 10, y_mm: Math.round((cy + s * x + c * y) * 10) / 10, z_mm: z, pitch_deg: -45 });
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]];
  const wps = [{ pose: P(-h, -h) }];
  const per = 6;      // intermediate points per edge keep the joint-space spline close to a straight line
  for (let k = 0; k < 4; k++) for (let i = 1; i <= per; i++) {
    const [ax, ay] = corners[k], [bx, by] = corners[k + 1];
    wps.push({ pose: P(ax + (bx - ax) * i / per, ay + (by - ay) * i / per) });
  }
  yield call('move_to', { pose: P(-h, -h) });
  const [r] = yield call('run_trajectory', { waypoints: wps });
  if (!r.ok) yield call('get_state');
  yield call('task_complete', { summary: 'Square traced.' });
}

function* idle() { yield call('task_complete', { summary: 'Nothing to do.' }); }

export const POLICIES = { 'solve-bowl': solveBowl, fail, wave, square, idle };

const chars = (x) => (typeof x === 'string' ? x.length : JSON.stringify(x || '').length);

export function mockClient(model) {
  const name = String(model).replace(/^mock\//, '');
  if (!POLICIES[name]) throw new Error('unknown mock model ' + model + ' (known: ' + Object.keys(POLICIES).map((k) => 'mock/' + k).join(', ') + ')');
  let gen = null, seq = 0;
  async function chat({ messages, tools }) {
    let it;
    if (!gen) {
      const prompt = messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      gen = POLICIES[name](prompt);
      it = gen.next();
    } else {
      // results of the previous batch = tool messages after the last assistant message (what a real model reads)
      const results = [];
      for (let i = messages.length - 1; i >= 0 && messages[i].role !== 'assistant'; i--) {
        if (messages[i].role === 'tool') { try { results.unshift(JSON.parse(messages[i].content)); } catch { results.unshift({ ok: false }); } }
      }
      it = gen.next(results);
    }
    const out = it.done || !it.value ? { text: 'Done.' } : it.value;
    const msg = { role: 'assistant', content: out.text || null };
    if (out.calls) msg.tool_calls = out.calls.map((c) => ({ id: `call_${++seq}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
    const prompt_tokens = Math.ceil((chars(messages) + chars(tools)) / 4), completion_tokens = Math.ceil(chars(msg) / 4);
    const cost_usd = (prompt_tokens * MOCK_PRICE.in_per_m + completion_tokens * MOCK_PRICE.out_per_m) / 1e6;
    return { message: msg, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop', usage: { prompt_tokens, completion_tokens, cost_usd, cost_source: 'mock' }, served_model: 'mock/' + name, provider: 'mock' };
  }
  return {
    kind: 'mock', chat,
    modelInfo: async () => ({ id: 'mock/' + name, vision: false, price_in_per_m: MOCK_PRICE.in_per_m, price_out_per_m: MOCK_PRICE.out_per_m })
  };
}
