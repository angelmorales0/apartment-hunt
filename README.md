# Bay Area Apartment Hunt

A map of 2-bedroom rentals. House Hunter finds listings. `scripts/enrich.py` runs the checks. GitHub Pages shows the map.

## Flow

1. House Hunter reads `requirements.json`.
2. House Hunter adds one new file to `listings/` for each run. It never edits an older file.
3. `scripts/enrich.py` merges all listings and writes `data/places.json`.
4. The site reads `data/places.json` and `requirements.json`.

## requirements.json

Each item has `id`, `list` (`shared`, `netflix`, or `palantir`), `kind`, `value`, `must`, and `label`.

The site applies these kinds by itself:

| kind | value |
|---|---|
| `max_rent` | Dollars a month |
| `min_beds` | Bedrooms |
| `max_bike_netflix_min` | Minutes. A goal only. It never filters places out when `must` is false |
| `max_commute_palantir_min` | Minutes by car, or `null` for no limit |
| `gym_near` | Miles |
| `gym_equipment` | `true` |
| `trail_near` | Miles |

Any other `kind` shows in the list. House Hunter must use it as a search filter when it hunts.

## Open units

The site only shows places with an open 2-bedroom. Set `open_2bed` to `false` on a listing to remove it. A row with no `open_2bed` counts as an active listing. Rows with a text `open_2bed` were checked by hand and beat feed rows for the same address. `data/watch_list.json` holds places with no open 2-bedroom on the last check.

## Listing file

A JSON array of objects. See `listings/` for examples. Use `null` for an unknown fact. Do not guess.
