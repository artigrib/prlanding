// CI guard: every relative import / script / preload reachable from the HTML pages of each built Space must
// resolve to a file inside that Space. Catches imports that reach outside the published folder (the AI panel
// once imported ../../../../backend/bridge-client/, which build-space.mjs did not copy, so it 404'd on the Space).
//   node tools/hf/build-space.mjs && node tools/hf/check-imports.mjs [dist-hf]
import fs from 'node:fs';
import path from 'node:path';
import { walkGraph } from './imports.mjs';

const OUT = path.resolve(process.argv[2] || 'dist-hf');
if (!fs.existsSync(OUT)) { console.error(`${OUT} does not exist; run node tools/hf/build-space.mjs first`); process.exit(2); }
let bad = 0;
for (const space of fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort()) {
  const root = path.join(OUT, space);
  const problems = walkGraph(root);
  for (const p of problems) console.log(`FAIL ${space}: ${path.relative(root, p.from)} -> '${p.spec}': ${p.problem}${p.target ? ` (${path.relative(root, p.target)})` : ''}`);
  if (!problems.length) console.log(`ok   ${space}: every import, script and preload resolves inside the Space`);
  bad += problems.length;
}
process.exit(bad ? 1 : 0);
