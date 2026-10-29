// Build check for data/components/*.json: schema + cross-references (every source has an https URL,
// a checked date and a status; plans use only recommended sources). Run by tools/build.mjs; also standalone:
//   node tools/check-components.mjs
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkData } from '../assets/plan/plan-core.mjs';

export function checkComponents(dir = 'data/components') {
  const errors = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.schema.json'))) {
    const data = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
    const schemaFile = `${dir}/${f.replace(/\.json$/, '.schema.json')}`;
    if (!fs.existsSync(schemaFile)) { errors.push(`${f}: missing ${schemaFile}`); continue; }
    const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
    for (const e of checkData(data, schema)) errors.push(`${f}: ${e}`);
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkComponents();
  if (errors.length) { console.error('component data check failed:\n  ' + errors.join('\n  ')); process.exit(1); }
  console.log('component data ok');
}
