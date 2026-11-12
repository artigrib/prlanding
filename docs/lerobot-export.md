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
  - order within a frame (`printedrobotics.recorder: 3`, from Nov 2026, LeRobot's convention): at the frame's time t
    the joints are read first, then `action` is the command the arm gets from t to the next page frame (observe →
    command). Recorders 1 and 2 stored the command of the page frame that *ended* at t, one frame earlier. Readers
    convert those on the fly: the Teach replay, the SIL replay and both exporters read a recorder 1 / 2 (or absent)
    `action` at t + 1/60 s (`OLD_ACTION_LAG`, one 60 Hz frame; the real frame length was not recorded) with linear
    interpolation, clamped at the last frame (`sim/so101/src/policy/episodes.js` `actionLag` / `alignActions`,
    `tools/hf/demos_to_lerobot.py` `action_lag` / `align_actions`, the same arithmetic). The demo JSON keeps its
    version number on import and download, so an old demo is never relabelled
  - joints in **degrees**, gripper in **0–100 % open** (`teach.js` converts radians and the gripper range)
  - frames are sampled on physics steps, so timestamps are only about 1/30 s apart. `printedrobotics.recorder: 2`
    and `3` (from Nov 2026): one frame per slot of a fixed 30 fps grid of simulated time, at any display rate;
    recorder 1 (field absent) took a frame 1/30 s after the previous one, about 20.8 fps at 16 ms frames. All load and
    export (the exporters resample onto the exact grid; actions as in the item above)
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
- No videos (`total_videos: 0`, `video_path: null`), so policies that need images cannot train on it as is. For the
  conveyor missions the SIL replay below adds rendered camera images.

## Camera images: the SIL replay (`tools/sil/replay.mjs`)

The browser records no images. For the conveyor missions (11 `waste_hand`, 12 `waste_teach`) the SIL tooling replays
a downloaded demo in node and renders virtual cameras, so the dataset gets `observation.images.<camera>`:

```
node tools/sil/replay.mjs so101-ukazka-waste_teach.json [more.json …] -o OUT [--camera up --camera wrist] [--camera-size 320x240]
python3 tools/hf/demos_to_lerobot.py OUT/replay-000.json -o OUT/lerobot-py      # the same dataset from Python
```

- **Replay** (`tools/sil/lib/replay.mjs`): the scene is compiled exactly as the page does it (`tools/sil/lib/plant.mjs`
  `loadScene({ scene: 'conveyor' })`), the demo is imported and replayed by the page's own `Teach` (snapshot restore,
  the mission batch restarted with the same seed, recorded actions written to `ctrl` with linear interpolation once
  per 16 ms frame, recorder 1 / 2 actions read 1/60 s later, the recorded belt command). No servo emulation in the loop ("kinematic" replay). Items, belt and
  contacts are simulated again and are not forced to match.
- **Divergence** is measured and reported (`OUT/report.json`, and `printedrobotics.replay` in each replayed demo):
  joint error (degrees) and gripper error (% open) at every recorded frame, the error of the recorded target / next
  item poses (mm, yaw in degrees), per item its largest error, and each item's outcome in the recording and in the
  replay.
- **What goes into the dataset** is the replay: `observation.state` (the replay's joints), the environment state and
  the per-item segments are recomputed from the replay (its own mission events, `cutEpisodes` / `cutFrames`), on an
  exact 30 fps grid (each frame = the 4 ms physics step nearest to `k / 30`); `action` is the recorded command in
  force from that time on, which is what the replay applied, so a replayed demo is written as `recorder: 3` whatever
  the input's version (the exporters do not shift it again). Images and state are therefore from the same instant.
- **Items whose outcome changed** in the replay (recorded `sorted`, replayed `dropped`, or no episode at all) are left
  out of the dataset (`--keep-diverged` / `keepDiverged` keeps them with the replay's label).
- **Images**: `observation.images.<camera>`, `dtype: image`, `shape: [H, W, 3]`, `names: [height, width, channels]`;
  Parquet column = HF `datasets` `Image` struct `{ bytes: PNG, path: null }`; HF feature `{"_type": "Image"}` in the
  Parquet metadata. Stats per channel with LeRobot's shape `(3, 1, 1)` in 0–1, from exact per-frame pixel sums that the
  replay stores (`printedrobotics.replay.images.sums`), so node and Python compute them without decoding PNGs.
- **Renderer** (`tools/sil/lib/raster.mjs`): flat-shaded triangles, no textures or shadows. Library items are drawn
  as their collision hulls in one colour per fraction (`tools/sil/lib/camera.mjs` `FRACTION_RGB`; plastic = the
  asset's own glTF base colour, the other three set by hand). The conveyor's belt frame and slats are drawn; slats past
  the head drum are hidden, as in the browser.
- Other missions replay too (plain scene: one episode per demo, no item state); checked only with a synthetic demo.
- `--no-env-state` / `envState: false` leaves `observation.environment_state` out (cameras + joints only, what a real
  arm has); the per-item episodes stay.
- Browser and Python write the same files from the same replay folder: `tools/hf/test_demos_to_lerobot.py` compares
  `info.json`, tasks, episodes, the dataset card, stats (to 1e-9) and every Parquet value including the PNG bytes.

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

- SIL replay with images, 12 Nov 2026 (LeRobot 0.6.1 from PyPI with `[dataset,training]`, Python 3.13, PyTorch 2.11,
  Node.js 22, 2-core x86_64, CPU only): a 125 s mission 11 demo and a 40 s mission 12
  demo recorded by `Teach` with the scripted planner in node, replayed with cameras `up` + `wrist` at 320×240.
  Divergence (mission 11): joints p95 0.75°, max 10.0°; gripper p95 1.8 %; 10 of 11 item outcomes as recorded (per
  item max position error 4–21 mm for nine of them; the spoon dropped in both runs but elsewhere, 126 mm; the fork,
  sorted in the recording, reached no bin in the replay and is left out). Mission 12: 3 of 3 outcomes, items ≤ 17 mm.
  Two replays of the same demo are identical (`tools/sil/test/conveyor.test.mjs`). Rendering 60 images/s at 320×240
  on one core (PNG encoding excluded); both demos (165 s) replayed, rendered and exported in 3 min. Dataset: 13
  episodes, 3,799 frames, 59 MB. LeRobot 0.6.1 converts it (`convert_dataset(root=…, push_to_hub=False)`, 0.4 s) and
  loads it; images come back as `(3, 240, 320)` float tensors equal to the replay's PNGs; `lerobot-train
  --policy.type=act` (with `--policy.pretrained_backbone_weights=null`: no download in our container) ran 3 steps
  (batch 8, CPU); ACT lists both cameras in `image_features`, its ResNet18 backbone receives gradients, and blanking
  the images changes the predicted action chunk. The same with `envState: false` (cameras + joints only). Node and
  Python exports of the same replay folder: identical Parquet values and metadata, stats equal to 1e-13.

- Recorder 1 vs 2 (30 fps grid), 12 Nov 2026, node, same tooling (`tools/sil/lib/replay.mjs`, no cameras). The same
  125 s mission 11 run (scripted planner, 16 ms frames) recorded both ways: recorder 1 2,605 frames (20.8 fps),
  joints p95 1.77°, max 7.55°; recorder 2 3,751 frames (30.0 fps), joints p95 1.67°, max 7.88°; gripper p95 1.7 / 2.0 %;
  10 of 11 outcomes in both. The sampling rate is not what drives the joint error. The recorded `action` is the
  command that was applied during the 16 ms frame *ending* at the frame's timestamp, while the replay applies it from
  that timestamp on: one frame late. Replaying one frame earlier (an experiment, not in the code) gives joints p95
  0.41° (recorder 2) / 0.72° (recorder 1), and 0.08° when every frame is recorded (80 s run).

- Recorder 2 vs 3 (observe → command), 12 Nov 2026, node, the same method and tooling as above (scripted planner,
  `replayDemo` without cameras). Each run is recorded once by each version; the simulated run is the same, only the
  stored `action` differs. "Recorder 2, read 1/60 s later" is the recorder 2 demo replayed by this version's
  compatibility rule:

  | Run | Recorder 2, old replay | Recorder 3 | Recorder 2, read 1/60 s later |
  |---|---|---|---|
  | M11, 125 s, 16 ms frames: joints p95 / max | 1.67° / 7.88° | 0.57° / 6.26° | 0.46° / 7.20° |
  | M11, same: gripper p95, item outcomes as recorded | 2.0 %, 10 / 11 | 1.3 %, 9 / 11 | 1.8 %, 10 / 11 |
  | M12, 40 s, 16 ms frames: joints p95 / max | 1.87° / 6.01° | 0.50° / 6.04° | 0.73° / 6.00° |
  | M12, same: gripper p95, item outcomes | 0.3 %, 3 / 3 | 0.1 %, 3 / 3 | 0.5 %, 3 / 3 |
  | M11, 60 Hz frames (4–5 physics steps): joints p95 | 1.68° | 0.75° | 0.79° |
  | M11, 144 Hz frames: joints p95 | 1.16° | 0.83° | 0.65° |

  Recorder 3 lowers the joint p95 against the old replay in every setting (by a factor of 1.4 at 144 Hz frames up to
  3.7 for M12), not the maximum everywhere (M11 at 144 Hz frames: 15.1° against 5.5°). It is not
  always below the recorder 2 demo read 1/60 s later (M11 at 16 ms and 144 Hz frames): what remains is mostly the
  30 fps sampling of commands that change every frame and their linear interpolation, which both share. Item outcomes
  move by one either way: in the M11 recorder 3 replay `vial_glass2` (dropped in the recording) is sorted, as in the
  recorder 2 replay, and the spoon, dropped in the recording, has no episode in the replay.

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
