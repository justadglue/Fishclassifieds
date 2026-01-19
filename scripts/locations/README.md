# AU Locations (search dropdown)

This folder contains the **source data** and **generation script** for Australia location options used by the frontend Location typeahead.

## What ships (deployed)

- `frontend/public/locations.au.json`

The frontend loads this at runtime via `/locations.au.json`.

## What does NOT ship (supporting artifacts)

- `scripts/locations/source/32180DS0002_2023-24.xlsx` (ABS workbook)
- `scripts/locations/generate_locations_au.mjs` (generator)

## Regenerating the JSON

From repo root:

- `npm run gen:locations:au`

