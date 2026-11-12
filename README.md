# Arrow Lakes Atlas

**A lake on the Columbia, in open data.** An animated 3D atlas for deciding where to live along the Arrow Lakes in British Columbia's West Kootenay, from Revelstoke to Castlegar. Built from the same blueprint as *Manitoulin Atlas* and *Island Atlas* (Vancouver Island).

![stack](https://img.shields.io/badge/MapLibre-deck.gl-4cc9f0) ![data](https://img.shields.io/badge/data-open-3ecf8e)

**Live site:** https://dtomyn.github.io/ArrowLakes-Discovery/

## What's in it

| Feature | What it does |
|---|---|
| 🌊 **Reservoir levels** (headline) | Monthly water levels since 1922. Since the Hugh Keenleyside Dam closed in 1968 the lake surface rises and sinks in its valley in 3D (×150), blue when full and mud-gold when drawn down, against a dashed record-high line. Before 1969, columns show the gauges on the natural lakes, compared by their yearly swing (their datums differ). |
| 🔥 **Wildfires** | Every BC Wildfire Service fire perimeter in the valley since 1919, plus the current season. Each fire flares as it starts, then settles into a lasting scar. Hectares per year, causes, and fires near communities. |
| 🌡 **Climate** | Adjusted temperatures at the long-running stations around the lakes, Revelstoke warming stripes, and what a year feels like at Castlegar airport. |
| ◉ **Earthquakes** | National catalogue since 1985 across the southern interior, natural quakes vs. blasts, drawn at depth. |
| ◍ **Population** | Annual estimates for Revelstoke, Nakusp, Castlegar and the regional-district areas around the lakes. |
| ⌂ **Homes & incomes** | 2021 Census median home value and household income per area. |
| ✚ **Health care** | Drive times to the nearest hospital and to the regional hospital in Trail, with animated routes. |
| ⛴ **Getting around** | The free inland ferries (Upper Arrow Lake, Needles, Arrow Park) with moving boats, airports, and drive times to the airport, Trail and Kelowna. |
| ⛰ **Hikes & waterfalls** | Every mapped footpath as a glowing web; the guide's 12 stops (Begbie and Sutherland falls, Mount Cartier, Saddle Mountain lookout, Nakusp and Halfway hot springs, Syringa, Castlegar's island and overlook) with elevation profiles, 3D flights over satellite imagery and a **Valley highlights tour** from Revelstoke to Castlegar. Trail Reports with photos, difficulty, sun times and best months. |
| ✦ **Valley life** | Beaches, marinas, hot springs (rising steam), waterfalls, trails, campgrounds and everyday services. |
| **Place Report** | Click any of 14 communities for its report card. |
| **Place Finder** | Rank the communities on 11 weighted factors, with presets. |
| **Data & sources** | A drawdown-bank view: one sediment core per source, one layer per year, every count read from the data. |

## Getting started

```bash
npm install
npm run dev
```

Open the address Vite prints. The built data in `public/data/` is included, so nothing else is needed.

Keys: `L` layers · `Space` play/pause · `←/→` step · `P` panel · `S` sources · `Esc` close. Hashes: `#water`, `#fires`, `#hikes`, `#finder`, `#sources`, …

## Refreshing the data

```bash
npm run data              # every stage
npm run data water fires  # just some
```

Stages: `base, places, population, census, water, fires, climate, normals, quakes, osm, trails, drive`. `trails` builds the path network, the routes and their elevation profiles, and finds Commons photos for the guide stops; the guide itself is `src/hikes.ts`, which the stage imports (Node 22.18+ runs it directly). Raw downloads are cached in `.cache/`; delete it to refetch everything. Overpass calls fall back across three public mirrors. A failing stage keeps its old file and records the error in `manifest.json`, which the sources view shows.

## Deploying

`npm run build` writes `dist/`. `.github/workflows/deploy.yml` publishes to GitHub Pages on a push to `main` (least-privilege permissions); the live site is https://dtomyn.github.io/ArrowLakes-Discovery/. The build adds a Content-Security-Policy.

## Data sources

| Data | Publisher | Licence |
|---|---|---|
| Monthly lake levels (HYDAT): 08NE104, 08NE102 (reservoir); 08NE045, 08NE046 (pre-dam) | Environment and Climate Change Canada | OGL-Canada |
| Fire perimeters, historical and current | BC Wildfire Service via the BC Data Catalogue | OGL-British Columbia |
| Adjusted annual temperatures (AHCCD); monthly records at Castlegar A and Nakusp CS | Environment and Climate Change Canada | OGL-Canada |
| Earthquakes | Natural Resources Canada | OGL-Canada |
| Population estimates (17-10-0155-01), 2021 Census Profile | Statistics Canada | OGL-Canada |
| Lake outline, amenities, trails, ferries, hospitals | OpenStreetMap contributors | ODbL 1.0 |
| Trails, routes, waterfalls | OpenStreetMap (Overpass); Wikidata; Wikimedia Commons photos; Mapzen / AWS terrain tiles | ODbL; CC0; each photo under its own Commons licence |
| Drive times | OSRM demo server on OpenStreetMap roads and ferries | ODbL (road data) |
| Basemap | CARTO Dark Matter | CC BY 4.0 / ODbL |

## Caveats

This is an exploration tool, not professional advice.

- **Reservoir levels** are monthly means at Nakusp; Lower Arrow Lake levels differ slightly, and daily swings are bigger than monthly ones. Pre-dam gauges use local datums and can't be compared by height.
- **Fire perimeters** before the 1950s were drawn by hand and miss many small fires. A perimeter is the outer edge; not everything inside it burned. Fires without a start date are placed in mid-July.
- **Census figures** cover whole regional-district electoral areas (Areas I, J and K, CSRD Area B), which reach far beyond the lakeshore; hamlets in one area share its numbers. Home values are owners' own estimates from May 2021.
- **Hospitals** are as mapped in OpenStreetMap; emergency-department hours aren't in open data. Check Interior Health before relying on one.
- **Drive times** are router estimates for free-flowing traffic; they don't include ferry waits, mountain-pass weather or winter driving.
- **"What it feels like"** climate figures are this atlas's own 30-year averages of valley-floor stations, not official normals; the mountains are colder and snowier.
- For a specific property, check zoning and floodplain bylaws, BC Hydro's reservoir flowage and erosion lines, wildfire risk, and well and septic records.
