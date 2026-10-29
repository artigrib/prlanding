# Předměty pro simulaci SO-101 / Objects for the SO-101 sim

Fyzikálně připravené 3D předměty (OpenUSD, např. NVIDIA SimReady na Hugging Face) převádíme na soubory pro
prohlížeč: `sim/so101/objects/<id>/<id>.glb` (vzhled, meshopt + WebP, max. 300 KB) a `<id>.xml` (MJCF tělo:
konvexní kolizní díly, hmotnost, setrvačnost, tření). Seznam je v `sim/so101/objects/manifest.json`,
autoři a licence v `sim/so101/objects/LICENSES.md`. Ukázka: `/sim/so101/objects.html`.

Physics-ready OpenUSD assets are converted into a meshopt/WebP GLB (≤ 300 KB) plus an MJCF body (convex hulls,
mass, full inertia, friction). `manifest.json` lists them; `LICENSES.md` carries the attribution.

## Pravidla licencí / Licence rules

- Povolené / allowed: CC0-1.0, CC-BY-4.0, CC-BY-3.0, Apache-2.0, MIT, BSD-2/3-Clause (`tools/assets/policy.json`).
- Vyloučené / excluded: NC, ND, SA, GPL, „research/evaluation only“, chybějící nebo neznámá licence, a když se
  licence datasetu, balíčku a USD neshodují. Unknown = excluded.
- Licence NVIDIA mimo SPDX (vlastní podmínky): až po přečtení přesného znění a potvrzení komerčního použití
  **a** šíření upravených kopií na webu je vlastník zapíše do `licenses.reviewed_custom` v `policy.json`.
  / NVIDIA-specific terms are added to `reviewed_custom` only after the owner has read them.
- Žádné značkové předměty / no branded objects: seznam `brands.deny` + vyplněné pole `manufacturer`/`brand`
  v metadatech vyřadí předmět. Výjimku (`brand_review` ve specifikaci) smí dát jen člověk, který předmět viděl.
- U CC BY musí zůstat řádek „attribution“ (stránka odkazuje na `LICENSES.md`).

## Import z Hugging Face (GitHub Action) / Running the import

1. Actions → **assets-import** → *Run workflow*.
2. `hf_repo` = dataset (`owner/name`), `assets` = názvy/globy balíčků oddělené čárkou (`apple*,mug_a01`),
   `max_count` = kolik nejvýš (1–50), `revision` = větev/tag/commit (připne se na SHA).
3. Akce stáhne **jen** vybrané balíčky (`allow_patterns`), projde licenční a značkovou kontrolou, převede je,
   v MuJoCo je pustí na stůl (3 orientace, nesmí vybuchnout ani propadnout) a otevře PR `assets/import-<run>`
   s výsledkem a tabulkou zařazených/vyřazených předmětů. Podrobné logy jsou v artefaktu běhu.
4. Před sloučením: zkontrolujte licence proti kartě datasetu, prohlédněte předměty v `objects.html`, opravte
   `name_cs`, kde je `name_cs_auto: true`.

Názvy / names: importér odvodí `name_cs` i `name_en` z názvu balíčku přes `tools/assets/names.json`
(podstatné jméno s rodem + přívlastky, např. `handTool_screwdriver_slotted_4mm_a01` → „Šroubovák plochý 4 mm“ /
“Slotted screwdriver 4 mm”). Neznámé slovo → oba názvy anglicky, `name_cs_auto: true` a poznámka v reportu; doplňte
slovo do `names.json` a spusťte `manifest.py --rename-auto`. `manifest.py` generuje
`sim/so101/src/i18n/objects-en.js` (CZ → EN), takže anglická verze stránky nikdy neukáže český název.
The import workflow runs all so101 node tests, `tests/smoke.mjs` and `tests/smoke-en.mjs` before opening the PR
(Actions-created PRs get no CI); a failure opens a draft PR with the failing lines.

Owner setup (once): *Settings → Actions → General → Workflow permissions*: “Read and write” and “Allow GitHub
Actions to create and approve pull requests” (otherwise the branch is pushed and the PR must be opened by hand).
Optional secret `HF_TOKEN` (read-only) avoids rate limits. PRs opened by the Action do not trigger `site-tests`
automatically; close/reopen the PR or push a commit to run them.

## Lokálně / Locally

```
python3 -m venv .venv && .venv/bin/pip install -r tools/assets/requirements.txt
npm ci --prefix tools/assets
.venv/bin/python -I tools/assets/test_pipeline.py                         # self-test, synthetic USD
.venv/bin/python -I tools/assets/import_assets.py --spec tools/assets/specs/gso-poc.json \
    --root <mujoco_scanned_objects>/models                                 # the 3 committed objects
.venv/bin/python -I tools/assets/validate.py --report /tmp/validate.json   # drop test, whole library
.venv/bin/python -I tools/assets/manifest.py                               # manifest.json + LICENSES.md
node --test sim/so101/test/objects.test.mjs                                # loader, injection, pick
```

Vlastní předmět: buď balíček USD (SimReady konvence: `<asset>/<mezisložka>/<asset>.usd`, `metersPerUnit`,
`upAxis`, UsdPreviewSurface, UsdPhysics kolize/hmotnost/materiál), nebo nová specifikace v `tools/assets/specs/`
(`kind: "usd"` pro hotové balíčky, `"gso"` pro modely Google Scanned Objects). Do specifikace patří `id`,
`name_cs`, `category`, licence, `attribution`, `source_url`, případně `scale`/`mass`/`friction`.

## Použití v kódu / Using objects in the sim

```js
import { ObjectLibrary, injectObjects } from './src/objects/library.js';
const lib = new ObjectLibrary();
const inst = [await lib.instance('mug', { pos: [0.17, -0.16, 0.004] })];
mj.FS.writeFile('/m/scene_objects.xml', injectObjects(sceneXmlText, inst));   // keyframes are extended
// after compiling: const view = await lib.attach({ THREE, loader, parent: world, mj, model, data, instances: inst });
// every frame: view.sync();
```
GLBs load lazily (only for instances you attach). `src/objects/pick.js` has a small IK top-down grasp
(`makePick`), used by `objects.html` and the unit test.
