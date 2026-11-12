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
- Conveyor missions (11 `waste_hand` on) add, all optional (older files load and export unchanged):
  - `episodes[0].frames[].env`: `{ belt, target, next }`, on every frame or on none. `belt` = commanded belt speed
    (m/s, 0 = paused); `target` = the item in the closed jaws, else the most downstream item on the belt; `next` = the
    most downstream belt item after it. Each is `{ item, class, pos: [x, y, z], yaw }` (centre of mass in the world
    frame, m; yaw about z, rad; class `paper | plastic | glass | metal`) or `null`. Simulator ground truth, no camera.
  - `printedrobotics.segments`: one entry per item, `{ item, class, outcome, bin, from, to, grasp, release }` (frame
    indexes into `episodes[0].frames`, inclusive; `grasp` / `release` = first hold / last release, `null` for a miss;
    `outcome` = `sorted | wrong | dropped | missed`). Cut from the mission's per-item
    events (`sim/so101/src/policy/episodes.js`): from the item entering the reach window (not before the arm let go of
    the previous item) to 0.5 s after the release, or to the miss.
  - `printedrobotics.snapshot.belt`: the commanded belt speed at the start of the recording (a replay restores it).
  - Both readers validate these like the frames: a partial or malformed `env` or `segments` rejects the file.

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
| `observation.environment_state` | list<float32>, 18 | only for demos with `env` frames: `target.{x, y, z, yaw_sin, yaw_cos, paper, plastic, glass, metal}`, then the same for `next.`; an absent item is all zeros |
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
- **Episodes per item.** A demo with `segments` becomes one LeRobot episode per item (`perItem: false` /
  `--whole` keeps one per file). The environment state is resampled by holding the nearest recorded frame (a class
  one-hot or a change of target is never blended); joints are interpolated as before. Demos with and without `env`
  cannot be mixed in one dataset (different features); the exporter refuses that.
- **`observation.environment_state` and real robots.** LeRobot maps this exact key to its `ENV` feature type, which
  ACT and Diffusion accept instead of images. A real `so101_follower` has no such sensor, so a policy trained on it
  runs only in the simulator; the dataset card says so.
- **Tasks** are English instructions for the known missions (`bowl`, `stack`, `sort`, `ball`, `trace`,
  `waste_*` = "Sort the waste into bins by material"); the
  demo's Czech title is used only for unknown missions; `task` / `--task` overrides.
- **Licence** defaults to CC BY 4.0 (`license` / `--license` to change). Every dataset is tagged `source: simulation`.
- No videos (`total_videos: 0`, `video_path: null`), so policies that need images cannot train on it as is.

## Verified

- `node --test sim/so101/tests/lerobot-export.test.mjs sim/so101/tests/lerobot-teach.test.mjs`: synthetic demos and a
  demo recorded by `Teach` on real MuJoCo physics in node.
- Datasets from the browser module, from the browser page (Playwright download) and from the Python script load with
  `lerobot==0.3.3` (the last release reading v2.1): `LeRobotDataset(repo_id, root=...)`, item shapes `[6]` float32,
  task strings, stats, timestamp sync check and `delta_timestamps` all work.
- **Stats number types.** `episodes_stats.jsonl` and `stats.json` carry min / max in the feature's dtype and mean /
  std always as floats (`0.0`, not `0`), as numpy writes them. LeRobot's v2.1 → v3.0 converter puts the stats of all
  episodes into one Arrow table, and an integer in one episode next to a float in another failed it
  (`ArrowInvalid: arrays to be concatenated must be identically typed`): before this, every multi-episode export
  whose `frame_index` mean was a whole number in one episode (odd length) and not in another failed the conversion.
- LeRobot ≥ 0.4 reads format v3.0. Convert with LeRobot's own script, in 0.6.1 the module
  `lerobot.scripts.convert_dataset_v21_to_v30` (`python -m lerobot.scripts.convert_dataset_v21_to_v30
  --repo-id=<user>/<dataset>`, or `--root=<folder> --push-to-hub=false` for a local copy).
- `observation.environment_state` against the LeRobot 0.6.1 wheel from PyPI (`lerobot-0.6.1-py3-none-any.whl`):
  the key is `OBS_ENV_STATE` in `lerobot/utils/constants.py`; `dataset_to_policy_features`
  (`lerobot/utils/feature_utils.py`) gives it `FeatureType.ENV` from that exact key and takes its `shape` from
  `info.json`; ACT (`lerobot/policies/act/configuration_act.py`, `validate_features`) accepts an ENV feature instead
  of images and projects it with one linear layer (`modeling_act.py`). ACT's default `normalization_mapping` has no
  `ENV` entry, so the environment state is not normalised unless you add `"ENV": "MEAN_STD"` (the stats are in the
  dataset either way). The v2.1 → v3.0 converter copies every Parquet column and the per-episode stats as they are
  and drops unknown `info.json` keys (`source`, `license`; the dataset card keeps them).
- Run with LeRobot 0.6.1 itself (PyPI wheel, Python 3.13, PyTorch 2.11 CPU), 12 Nov 2026: a 49 s mission 11
  recording by `Teach` on real MuJoCo physics (4 sorted items → 4 episodes, 909 frames), the browser export and the
  Python script on the same demo (identical `info.json`, episodes, tasks, Parquet columns and dataset card; stats equal
  to 1e-12) both convert with `convert_dataset(root=…, push_to_hub=False)` and load as `LeRobotDataset`:
  `observation.environment_state` is a `(18,)` float32 tensor with stats, the task is "Sort the waste into bins by
  material", `dataset_to_policy_features` gives it type `ENV`, and an ACT policy built from those features
  (`validate_features` passes with no image) runs a training forward pass. Joints-only exports (3 episodes) convert
  and load too; the same export from before the stats fix fails the conversion as described above.

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
