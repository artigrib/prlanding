# Device packages

One folder per platform the forge CAD agent can design add-ons for. `devices/<id>/device.json` (schema `schema/device.schema.json`) names the sim model, the mount library (`mounts.schema.json`), power/data ports (`ports.schema.json`), the check profile (`checks.schema.json`), joint groups, sweep grids and poses. forge loads it with `forge.device.load_device(id)`; nothing in forge should name a robot's joints or files directly.

Validate: `cd backend/forge && python3 -m unittest tests.test_device`.
