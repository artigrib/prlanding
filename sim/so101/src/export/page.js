// lerobot.html: turn demo JSON files from the simulator into a LeRobot dataset zip, all in the browser.
// Czech is the source text (like the rest of the site); English strings are in the dictionary below.
import '../../../../assets/i18n.js';
import { exportLeRobotZip } from './lerobot.js';

const I = globalThis.PRI18N;
I.initSim({
  strings: {
    'Export ukázek SO-101 do LeRobot | printedrobotics.cz': 'Export SO-101 demos to LeRobot | printedrobotics.cz',
    'Převeďte ukázky nahrané v simulátoru SO-101 na dataset LeRobot (Parquet, v2.1) přímo v prohlížeči. Nic se nikam neodesílá.':
      'Turn demonstrations recorded in the SO-101 simulator into a LeRobot dataset (Parquet, v2.1) right in your browser. Nothing is uploaded.',
    'SO-101 · export do LeRobot': 'SO-101 · LeRobot export', 'Do simulátoru': 'To the simulator',
    'Učení ukázkou → dataset': 'Teach by demonstration → dataset',
    'Export ukázek do formátu LeRobot': 'Export demonstrations as a LeRobot dataset',
    'Ukázku nahranou v simulátoru převedeme na dataset LeRobot (formát v2.1: Parquet a metadata). Vše proběhne ve vašem prohlížeči, nic se nikam neodesílá.':
      'A demonstration recorded in the simulator becomes a LeRobot dataset (format v2.1: Parquet plus metadata). Everything happens in your browser; nothing is uploaded.',
    'V simulátoru nahrajte ukázku (Učení ukázkou) a stáhněte ji jako JSON.': 'Record a demonstration in the simulator (Teach by demonstration) and download it as JSON.',
    'Vyberte jeden nebo více souborů JSON. Každý soubor bude jedna epizoda.': 'Pick one or more JSON files. Each file becomes one episode.',
    'Stáhněte ZIP a nahrajte složku na Hugging Face jako dataset.': 'Download the zip and upload the folder to Hugging Face as a dataset.',
    'Soubory s ukázkami (JSON)': 'Demonstration files (JSON)',
    'Název datasetu (nepovinné)': 'Dataset name (optional)', 'uzivatel/so101-sim-demos': 'user/so101-sim-demos',
    'Popis úlohy anglicky (nepovinné)': 'Task description in English (optional)',
    'Stáhnout dataset (ZIP)': 'Download dataset (zip)',
    'Licence datasetu: CC BY 4.0, označení source: simulation.': 'Dataset licence: CC BY 4.0, tagged source: simulation.',
    'Robot so101_follower, 30 snímků/s, klouby ve stupních, chapadlo 0–100 %, bez kamerových záznamů.': 'Robot so101_follower, 30 fps, joints in degrees, gripper 0–100 % open, no camera streams.',
    'Parquet zapisuje knihovna hyparquet-writer (MIT).': 'Parquet is written by hyparquet-writer (MIT).'
  },
  patterns: [
    [/^Hotovo: (\d+) epizod\S*, (\d+) snímků → (.+)$/, 'Done: $1 episode(s), $2 frames → $3'],
    [/^Vybráno souborů: (\d+)$/, 'Files selected: $1'],
    [/^Soubor (.+) nejde převést: (.+)$/, 'Cannot convert $1: $2']
  ]
});
I.simSwitcher(document.getElementById('lang-sw'));

const $ = (id) => document.getElementById(id);
const files = $('files'), go = $('go'), out = $('out');
const say = (msg, err) => { out.textContent = msg; out.classList.toggle('err', !!err); };
files.addEventListener('change', () => { go.disabled = !files.files.length; say(files.files.length ? `Vybráno souborů: ${files.files.length}` : ''); });

go.addEventListener('click', async () => {
  const demos = [];
  for (const f of files.files) {
    try {
      if (f.size > 8 * 1024 * 1024) throw new Error('> 8 MB');
      demos.push(JSON.parse(await f.text()));
    } catch (e) { say(`Soubor ${f.name} nejde převést: ${e.message}`, true); return; }
  }
  go.disabled = true;
  try {
    const repoId = $('repo').value.trim() || undefined, task = $('task').value.trim() || undefined;
    let res;
    try { res = await exportLeRobotZip(demos, { repoId, task }); }
    catch (e) { say(`Soubor ${files.files[0].name} nejde převést: ${e.message}`, true); return; }
    const info = JSON.parse(res.files['meta/info.json']);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([res.bytes], { type: 'application/zip' }));
    a.download = res.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say(`Hotovo: ${info.total_episodes} epizod, ${info.total_frames} snímků → ${res.name}`);
  } finally { go.disabled = !files.files.length; }
});
