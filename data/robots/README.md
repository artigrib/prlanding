# Catalogue robots: one file per robot

Every catalogue entry is one file, `data/robots/<id>.json`: the Czech fields plus an `en` block with
the English overrides. `node tools/build.mjs` checks the files and generates `assets/data.js` and
`assets/data.en.js` from them; the pages keep reading the same `window.PR_*` globals. Never edit the
two generated files by hand.

Other catalogue data that is not one robot stays hand-edited in `data/catalogue/catalogue.js` (colours,
categories `PR_CATS`, sims, licence table, safety/BOM/FAQ functions) and `data/catalogue/catalogue.en.js`
(their English, `PR_EN_APPLY`).

## Add a robot

1. Copy a similar robot's file to `data/robots/<id>.json` and set `"id"` to the same `<id>`
   (lowercase, used in URLs: `/sada/<id>/`, `/en/kit/<id>/`, `img/<id>_<colour>.jpg`).
2. Fill the Czech fields. Required for a kit: `id name type cat level hw sw author alt short lead
   bomCost printTime software repo docs card specs related en`. Unknown values are `"—"`.
   `cat` is a `PR_CATS` key; `level` is `Začátečník`, `Střední` or `Pokročilý`. The full list of
   fields and their types is `KEYS` in `tools/catalogue.mjs`.
3. Fill `en` with the English text. Only translated fields go there (`name type hw sw author alt credit
   short lead bomCost printTime software bomDocs card bom mats specs`), each replacing a Czech field
   of the same type; `card`, `bom`, `mats` and `specs` need the same number of rows as the Czech ones.
   `type` and `software` may be left out when `PR_EN.values` already translates the Czech value.
4. Add the id to `data/robots/_order.json`: `"robots"` lists the kits in catalogue order (the
   position is the N° number), `"showcase"` the showcase projects (no kit page).
5. Run `node tools/build.mjs` and `node --test tests/*.test.mjs`, then commit the new JSON file,
   `_order.json` and the regenerated `assets/data.js` / `assets/data.en.js` together with the pages.

A note for maintainers that should not be published goes in a top-level `"//"` field (a string or a
list of strings); the build drops it.

The build stops with a list of errors when a file is invalid JSON, misses a required field, has an
unknown field or English key, an id that does not match its file name, a duplicate or missing entry
in `_order.json`, or a `related` id that does not exist (`tests/catalogue-robots.test.mjs`).
