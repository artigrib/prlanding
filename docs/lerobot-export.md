# LeRobot export of SO-101 simulator demonstrations

The SO-101 simulator records demonstrations ("Učení ukázkou" / "Teach by demonstration", `sim/so101/src/ui/teach.js`)
and downloads them as JSON. This export turns one or more of those JSON files into a
[LeRobot](https://github.com/huggingface/lerobot) dataset, **format v2.1**, joints only (the simulator records no camera
streams). Two equivalent implementations:

| Where | What | Use |
|---|---|---|
| Browser | `sim/so101/src/export/lerobot.js` + page `sim/so101/lerobot.html` | pick JSON files, get a zip; nothing is uploaded |
| Python | `tools/hf/demos_to_lerobot.py` (needs `pyarrow`) | batch conversion, scripts, CI |

Both write the same metadata and identical Parquet contents (checked against each other; stats agree to float rounding).

## Input: the demo JSON (`printedrobotics.cz/so101-sim-demo@1`)

Written by `Teach.toJSON()` / `Teach.download()`:

- `fps: 30`, `robot_type: so101_follower`, `printedrobotics.mission` (mission id), `printedrobotics.snapshot` (scene state, ignored here)
- `episodes[0].frames[]`: `{ frame_index, timestamp, observation.state: [6], action: [6] }`
  - `observation.state` = joint positions (MuJoCo `qpos`), `action` = position targets (MuJoCo `ctrl`)
  - joints in **degrees**, gripper in **0–100 % open** (`teach.js` converts radians and the gripper range)
  - frames are sampled on physics steps, so timestamps are only about 1/30 s apart

## Output layout

```
<name>/
  README.md                         dataset card: license cc-by-4.0, tags LeRobot/so101/simulation, source: simulation
  meta/info.json                    codebase_version v2.1, robot_type so101_follower, fps 30, features, totals
  meta/tasks.jsonl                  {"task_index":0,"task":"Move the cube into the bowl"}
  meta/episodes.jsonl               {"episode_index":0,"tasks":[...],"length":N}
  meta/episodes_stats.jsonl         per-episode min/max/mean/std/count of every feature (v2.1)
  meta/stats.json                   aggregated stats (what v2.0 readers expect)
  data/chunk-000/episode_000000.parquet
```

Parquet columns (one row per frame), matching LeRobot's `features`:

| Column | Type | Notes |
|---|---|---|
| `action` | list<float32>, 6 | `shoulder_pan.pos, shoulder_lift.pos, elbow_flex.pos, wrist_flex.pos, wrist_roll.pos, gripper.pos` |
| `observation.state` | list<float32>, 6 | same names |
| `timestamp` | float32 | exactly `frame_index / 30` |
| `frame_index`, `episode_index`, `index`, `task_index` | int64 | `index` is global across episodes |

The Parquet key-value metadata carries the Hugging Face `datasets` feature types (`huggingface` key), as LeRobot's own
files do. `meta/info.json` also carries `"source": "simulation"` and `"license": "cc-by-4.0"` (LeRobot ignores
extra keys); the dataset card repeats both.

Choices that matter:

- **Resampling.** LeRobot checks that every timestamp equals `frame_index / fps` within 1e-4 s, so frames are
  linearly interpolated onto an exact 30 fps grid.
- **Joint names and units** follow LeRobot's `so101_follower` (`<joint>.pos`; body joints in degrees as with
  `use_degrees=True`, gripper 0–100). Zero is the simulator's zero pose (MuJoCo Menagerie model), which is not the
  calibration zero of a particular real arm: treat the data as simulation data, not as a drop-in for a real robot.
- **Tasks** are English instructions for the known missions (`bowl`, `stack`, `sort`, `ball`, `trace`); the
  demo's Czech title is used only for unknown missions; `task` / `--task` overrides.
- **Licence** defaults to CC BY 4.0 (`license` / `--license` to change). Every dataset is tagged `source: simulation`.
- No videos (`total_videos: 0`, `video_path: null`), so policies that need images cannot train on it as is.

## Verified

- `node --test sim/so101/tests/lerobot-export.test.mjs sim/so101/tests/lerobot-teach.test.mjs`: synthetic demos and a
  demo recorded by `Teach` on real MuJoCo physics in node.
- Datasets from the browser module, from the browser page (Playwright download) and from the Python script load with
  `lerobot==0.3.3` (the last release reading v2.1): `LeRobotDataset(repo_id, root=...)`, item shapes `[6]` float32,
  task strings, stats, timestamp sync check and `delta_timestamps` all work.
- LeRobot ≥ 0.4 reads format v3.0. Convert with LeRobot's own script after uploading
  (`python -m lerobot.datasets.v30.convert_dataset_v21_to_v30 --repo-id=<user>/<dataset>`); this step was not run here.

## Using it

Browser, standalone page: open `sim/so101/lerobot.html` (`?lang=en` for English), pick the downloaded JSON files,
optionally a dataset name and an English task, download the zip, unzip, then

```
huggingface-cli upload <user>/<dataset> <unzipped folder> --repo-type dataset
```

Python:

```
pip install pyarrow
python3 tools/hf/demos_to_lerobot.py so101-ukazka-bowl.json more.json -o so101-sim-demos --repo-id <user>/so101-sim-demos
```

Module API (`sim/so101/src/export/lerobot.js`, ES module, no DOM except `downloadLeRobot`):

```js
import { buildDataset, exportLeRobotZip, downloadLeRobot } from './src/export/lerobot.js';
const files = await buildDataset([demoJson], { repoId, task, license });   // { 'meta/info.json': '…', 'data/…parquet': Uint8Array, … }
const { bytes, name } = await exportLeRobotZip([demoJson]);                 // store-only zip
await downloadLeRobot([demoJson]);                                          // browser download
```

The Parquet writer (`sim/so101/vendor/hyparquet-writer/`, MIT, 56 kB) is imported only when exporting.

### Optional hook in the simulator panel (not applied)

The simulator UI is untouched. To offer the export straight from the "Teach" panel, add next to the existing
`ux-export` handler in `sim/so101/src/ui/panel.js` (one button + one line):

```js
// <button type="button" class="ux-link" id="ux-lerobot" disabled>Stáhnout jako dataset LeRobot <span aria-hidden="true">⤓</span></button>
$('ux-lerobot').addEventListener('click', async () => { const j = this.ux.teach.toJSON(); if (j) (await import('../export/lerobot.js')).downloadLeRobot([j]); });
```

(enable/disable it together with `ux-export`, and add the English string to `src/i18n/en.js`). Until then the
standalone page covers the same flow with the downloaded JSON.
