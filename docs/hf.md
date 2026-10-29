# Hugging Face Spaces

The two browser sims are published as **static Hugging Face Spaces**:

| Space | Source | Built folder |
|---|---|---|
| `<org>/so101-sim` | `sim/so101/` (MuJoCo WASM SO-101 simulator, setup wizard, object library, LeRobot export page) | `dist-hf/so101-sim` |
| `<org>/combat-arena` | `sim/arena/` (prebuilt `build/`, robot models from `models/`) | `dist-hf/arena` |

`<org>` is the repository variable `HF_ORG`, default `printedrobotics`.

## Owner steps (once)

1. **Create the organisation** on huggingface.co: *New → Organization*, name `printedrobotics` (or another name, see
   step 4). Optional: avatar, link to printedrobotics.cz.
2. **Create a fine-grained token**: *Settings → Access Tokens → Create new token → Fine-grained*.
   - Name e.g. `github-prlanding-spaces`.
   - Under *Org permissions* pick the organisation and tick **Write access to contents/settings of all repos in
     the org** (needed to create the two Spaces the first time; you can narrow it to the two Space repos after the
     first successful run, under *Repositories permissions*).
   - Leave every user-level permission unticked. No inference, billing or webhook permissions are needed.
3. **Add the token to GitHub**: repository *Settings → Secrets and variables → Actions → New repository secret*,
   name `HF_TOKEN`, value the token. Nobody else (including Claude) needs to see it.
4. *(Optional)* If the organisation is not called `printedrobotics`: same page, tab *Variables* → new repository
   variable `HF_ORG` = the organisation name.
5. Run the workflow: *Actions → hf-publish → Run workflow* (branch `main`). The log ends with
   `so101-sim: published https://huggingface.co/spaces/<org>/so101-sim` and the same line for `combat-arena`.
   Later runs happen automatically on every push to `main` that changes the sims (see `paths:` in the workflow).

Without the secret the workflow ends green with the notice *"HF_TOKEN not set"*. To stop publishing, delete the
secret or disable the workflow. To revoke access, delete the token on Hugging Face.

## What gets published

`node tools/hf/build-space.mjs` (run by the workflow; you can run it locally, output in `dist-hf/`, git-ignored)
copies only what the pages load, keeping the site's folder layout so every relative path in the sims works unchanged:

- SO-101: `sim/so101/` without tests, tools and notes (pages, `src/`, `lib/`, `model/`, `objects/`, `vendor/`,
  NOTICE and LICENSE files) and `assets/i18n.js`. About 16 MB; `mujoco.wasm` (10.4 MB) goes through Git LFS, which
  `upload_folder` handles automatically.
- Arena: `sim/arena/index.html`, `NOTICE.txt`, `build/`, and the robot models listed in
  `sim/arena/src/robots/catalog.js` (`models/<id>.glb`) with `models/NOTICE.txt`. About 4 MB.
- Added per Space: `README.md` (Space card: `sdk: static`, title, emoji, colours, tags, licence, description,
  attributions), `LICENSE.md` (licence table), `index.html` and `hf-space.js`.

On Hugging Face the sims start in **English** (`index.html` forwards to `sim/<name>/?lang=en`; the CZ/EN switch in
the header works, and a visitor's saved choice wins). `hf-space.js` points the links back to the website
(`../../sada/so101/` etc.) at `https://printedrobotics.cz` (the English pages when the sim is in English), opens them in
a new tab (a Space runs inside an iframe), and shows one small dismissible link: *"Get the real SO-101 kit · more at
printedrobotics.cz"* / *"Build a real antweight"*. There is no analytics, no tracking parameter and no request to any
server other than the Space itself and Google Fonts (which the sims already use).

The upload (`tools/hf/publish_spaces.py`, `huggingface_hub` `upload_folder`) mirrors `dist-hf/<space>` into the Space
repository: files that disappeared from the build are deleted there (`.gitattributes` is kept). It prints only fixed
status lines.

## Licences

| What | Licence |
|---|---|
| SO-101 robot model (MuJoCo Menagerie `robotstudio_so101`, The Robot Studio), modified | Apache-2.0 |
| MuJoCo WASM bindings | Apache-2.0 |
| Rapier (arena physics) | Apache-2.0 |
| three.js, meshoptimizer decoder, hyparquet-writer + hyparquet | MIT |
| Feetech tables / setup flow re-implemented after LeRobot | Apache-2.0 |
| Scanned objects (Google Scanned Objects) | CC BY 4.0 |
| svrn.glb (Shoverobotics), kosa.glb and klepeto.glb (printedrobotics.cz) | CC BY 4.0 |
| vert150.glb (TheBlackfish / Muffin578), adapted | CC BY-SA 4.0 |
| printedrobotics.cz's own code | **not declared yet** |

The repository has no licence file for printedrobotics.cz's own code, so the Space cards say `license: other` and
`LICENSE.md` states that the code is public but not yet openly licensed. Once you choose a licence, add it to the
repository and set it for the Spaces by adding `HF_CODE_LICENSE: mit` (or `apache-2.0`, …) to the `env:` of the
*Build Space folders* step in `.github/workflows/hf-publish.yml`.

Exported LeRobot datasets (see [lerobot-export.md](lerobot-export.md)) default to CC BY 4.0 and are tagged
`source: simulation`.
