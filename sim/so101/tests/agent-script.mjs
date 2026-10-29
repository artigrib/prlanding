// Mission 01 ("bowl") solved only through the agent tools, the way an MCP client would do it.
// Shared by the node test (tests/agent-api.test.mjs, direct calls) and the end-to-end test
// (tests/agent-e2e.mjs, real MCP client through the relay).
//   call(tool, args) -> structured result (throws on a tool error)
//   wait(cond, maxSec) -> resolves when the page reports cond(checkMission) or gives up (time keeps running)

const wrap90 = (a) => { a = ((a % 90) + 90) % 90; return a >= 45 ? a - 90 : a; };

export async function solveBowl(call, { wait, log = () => {} } = {}) {
  await call('start_mission', { mission_id: 'bowl' });
  const scene = await call('get_scene', {});
  const cube = scene.objects.find((o) => o.id === 'cube');
  const bowl = scene.objects.find((o) => o.id === 'bowl');
  const c = cube.pose, b = bowl.pose;
  log(`cube at ${c.x_mm},${c.y_mm},${c.z_mm} yaw ${cube.yaw_deg}; bowl at ${b.x_mm},${b.y_mm}`);

  // 1. above the cube, gripper open
  let r = await call('move_to', { pose: { x_mm: c.x_mm, y_mm: c.y_mm, z_mm: 90 }, gripper_pct: 70 });
  // 2. turn the wrist so the jaws close across two faces of the cube
  const dr = wrap90(cube.yaw_deg - r.final.tool.jaw_yaw_deg);
  const roll = r.final.goal_deg.wrist_roll + dr;
  r = await call('move_to', { pose: { x_mm: c.x_mm, y_mm: c.y_mm, z_mm: 60, roll_deg: roll } });
  log(`roll ${roll.toFixed(1)}: jaw yaw ${r.final.tool.jaw_yaw_deg}`);
  // 3. down to the cube's centre, close
  r = await call('move_to', { pose: { x_mm: c.x_mm, y_mm: c.y_mm, z_mm: Math.max(10, c.z_mm - 2), roll_deg: roll }, duration_s: 1.5 });
  r = await call('set_gripper', { gripper_pct: 'close' });
  // 4. lift, carry over the bowl, lower, release
  r = await call('move_to', { pose: { x_mm: c.x_mm, y_mm: c.y_mm, z_mm: 100, roll_deg: roll }, duration_s: 1.5 });
  log(`lifted: held ${r.final.held_object}`);
  r = await call('move_to', { pose: { x_mm: b.x_mm, y_mm: b.y_mm, z_mm: 100, roll_deg: roll }, duration_s: 2 });
  r = await call('move_to', { pose: { x_mm: b.x_mm, y_mm: b.y_mm, z_mm: 45, roll_deg: roll }, duration_s: 1.2 });
  r = await call('set_gripper', { gripper_pct: 'open' });
  r = await call('move_to', { pose: { x_mm: b.x_mm, y_mm: b.y_mm, z_mm: 110 } });
  // 5. the cube must rest in the bowl for 0.5 s
  const done = await wait((m) => m.state === 'success', 6);
  return done;
}
