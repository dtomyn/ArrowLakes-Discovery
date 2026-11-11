# Map Atlas Blueprint

A reusable spec for building an animated, open-data map atlas with the same look, feel and capabilities as **Island Atlas** (Vancouver Island in data), plus a scripted explainer video filmed from the real app.

**How to use this file**

1. Copy it into a new, empty repository.
2. Fill in **Part 1 – Project brief** (the only part you need to write). Delete the example lines in *italics*.
3. Give it to Claude Code with: *"Build this atlas from MAP-ATLAS-BLUEPRINT.md. Start with the milestones in Part 9, one at a time."*

Parts 2–8 are the house style and architecture. Change them only on purpose, so every atlas you make feels like part of the same family.

---

## Part 1 – Project brief (Arrow Lakes Atlas)

### 1.1 The idea

| Field | Your answer |
|---|---|
| Atlas name | Arrow Lakes Atlas |
| Tagline | A lake on the Columbia, in open data |
| The one question it answers | Where on the Arrow Lakes should we live? |
| Region | The Arrow Lakes valley, Revelstoke to Castlegar (West Kootenay, British Columbia) |
| Bounding box (W, S, E, N) | -118.45, 49.2, -117.45, 51.05 |
| Wider box | -121.0, 47.8, -114.5, 52.6 (earthquakes); -118.9, 48.95, -116.85, 51.4 (adjusted climate stations) |
| Opening camera | intro: -118.4, 49.4, zoom 5.4, flat; home: -117.72, 49.98, zoom 7.75, pitch 52, bearing -8 |
| Outline geometry | OpenStreetMap relations 2198542 (Upper Arrow Lake) and 2198541 (Lower Arrow Lake) via Nominatim, simplified; outer shorelines only |
| Timeline span | 1919 → today (fires); lake levels from 1922 (natural) and 1969 (reservoir) |
| Accent colour | per layer (reservoir cyan `#4cc9f0` on the headline layer) |
| Brand mark colours | default |
| Live site URL | not deployed yet |

### 1.2 Places

| Field | Your answer |
|---|---|
| What a place is | community (city, village or hamlet) |
| Where the list comes from | hand-kept list in `scripts/places.mjs` (OSM place nodes) mapped to 2021 census subdivisions (cities, villages and regional-district electoral areas) |
| Rename to | Place Report / Place Finder |
| Finder headline question | Where on the Arrow Lakes should we live? |

There are no reserves on the lakes today. The opening panel names the Sinixt, whose homeland the lakes are.

### 1.3 Layers

| id | Name | Icon | Colour | Kind | Years | Visual idiom | Source | Licence |
|---|---|---|---|---|---|---|---|---|
| water | Reservoir levels | 🌊 | #4cc9f0 | time (monthly) | 1922 → HYDAT latest | **Rising lake surface** (×150) from 1969; pre-dam gauge columns before | ECCC HYDAT, hydrometric-monthly-mean | OGL-Canada |
| fires | Wildfires | 🔥 | #ff7a45 | time | 1919 → today | **Flare then scar** | BC Wildfire Service perimeters (WFS) | OGL-BC |
| climate | Climate | 🌡 | #f25f5c | time | 1890s → AHCCD latest | Station colour + warming stripes | ECCC AHCCD annual; Castlegar A and Nakusp CS monthly | OGL-Canada |
| quakes | Earthquakes | ◉ | #f9d65c | time | 1985 → today | Ripple at depth (blasts greyed) | NRCan FDSN | OGL-Canada |
| population | Population | ◍ | #3ecf8e | time | 2001 → 2025 | Place columns | StatCan 17-10-0155-01 | OGL-Canada |
| homes | Homes & incomes | ⌂ | #b388ff | static | 2021 Census | Place columns | StatCan Census Profile SDMX | OGL-Canada |
| health | Health care | ✚ | #6c8cff | static | today | Place columns + animated road route | OSM hospitals + OSRM | ODbL |
| access | Getting around | ⛴ | #ff8a3d | static | today | Ferries with moving boats, airports, columns | OSM + OSRM | ODbL |
| hikes | Hikes & waterfalls | ▲ | #34d399 | static | today | Glowing web, beams, 3D flights | OSM, Wikidata, Commons, terrain tiles | ODbL / CC0 / various |
| life | Valley life | ✦ | #ffd166 | static | today | Hot-spring steam, waterfall beams, glowing trails, POI glow | OSM Overpass | ODbL |

### 1.4 Historic events

Data-driven: record-high and record-low reservoir months, the poorest summer refill, the worst fire year, the largest fire, the biggest fire season this century, the warmest year, the largest natural quake. Curated: 1964 Columbia River Treaty, 1968 Hugh Keenleyside Dam, 1973 Mica Dam, 1984 Revelstoke Dam, 2021 R. v. Desautel.

### 1.5 Place Report and Place Finder

Criteria: affordability, hospital, groceries, regional hospital (Trail), airport (Castlegar), lakeshore, beaches & boating, trails & views, shops & services, fellow retirees, growing community. Presets: Balanced, Retiree comforts, Lakeside life, On a budget, Quiet & wild.

### 1.6 Deep finder

Not built yet (no open parcel data with values; see ROADMAP).

### 1.7 Data & sources view

| Field | Your answer |
|---|---|
| Metaphor | The banded silt of the reservoir's drawdown banks |
| One unit of time | one sediment layer per year, oldest at the bottom |
| Present-day sources | a bright cap layer at the top |

### 1.8 Explainer film

Not ported yet (see ROADMAP).

---

## Part 2 – Principles (don't break these)

1. **Open data only.** Every number comes from a named public source with a licence. No scraped paywalled data, no invented values (e.g. tsunami arrival times only from published modelling, never estimated).
2. **Re-runnable data, no manual downloads.** All data arrives through `npm run data` stages. Prove it by deleting `.cache/` and running from empty. Anything genuinely impossible to fetch (no feed exists) is typed into a script with a dated comment and listed under "Still open" in the roadmap.
3. **Fully static site.** No backend. Pre-built JSON in `public/data/` is committed, so `npm install && npm run dev` works immediately.
4. **Honest labelling.** Projections look different from records (hatched, dashed, a "projection, not a record" badge). Show ranges, not single numbers, for model output. Say when a value is borrowed from the nearest station, estimated, or covers a wider area. Missing data is skipped, never penalized.
5. **Starts empty.** The map opens on just the region with place dots. Nothing is overlaid until the user picks a layer.
6. **Every number is counted from the loaded data**, including the counts on the sources page and figures said in the video narration.
7. **Escape everything from data.** Names from crowd-edited sources (OpenStreetMap, Wikidata) or the visitor go through `esc()` before `innerHTML`; links go through `safeUrl()`. A build-time Content-Security-Policy backs this up.
8. **Plain English.** UI text, panel ledes and narration are short, concrete and jargon-free. Explain what a measure means ("2% chance in 50 years") the first time it appears.
9. **Caveats section.** The README says it's an exploration tool, not professional advice, and names the main limitations of the data.

---

## Part 3 – Stack and repo layout

- **MapLibre GL JS** basemap: CARTO Dark Matter style, shaded relief from Mapzen/AWS Terrarium tiles.
- **deck.gl** (`@deck.gl/core`, `layers`, `aggregation-layers`, `geo-layers`, `extensions`, `mapbox`) through `MapboxOverlay({ interleaved: true })`, so flat layers can sit under basemap labels.
- **d3** for panel charts and scales.
- **Vite + TypeScript**, `base: './'` so it works from any GitHub Pages sub-path.
- Pipeline: **Node ESM scripts**; dev deps only (`@turf/*`, `exceljs`, `fflate` as needed).
- Video: **Python 3.12 + Playwright (Microsoft Edge for GPU WebGL) + imageio-ffmpeg + kokoro-onnx + soundfile + numpy**, in a `uv` venv at `.venv/`.

```
index.html                 app shell: map, appbar, panel, top actions, timeline, toasts, tooltip, modal, loader
src/main.ts                state, map init, render loop, focus/menu/timeline, keyboard, hashes, ?film handle
src/layers.ts              AtlasLayer interface + one factory per layer + CURATED_EVENTS
src/data.ts                types for every JSON file, loadAll(), formatters (fmt), helpers (km, lowerBound…)
src/metrics.ts             per-place derived metrics, CRITERIA, rankPlaces()
src/panels.ts              Place Report and Place Finder panels, weights in localStorage
src/charts.ts              d3 barChart, lineChart, scatterChart, stripes, rampCSS — all with a playhead
src/sources.ts             the Data & sources view
src/<deepfinder>.ts        optional deep finder (rail, funnel, report, shortlist)
src/html.ts                esc(), safeUrl()
src/style.css              the whole design system (Part 4)
scripts/fetch-data.mjs     pipeline: SOURCES stages, cache, manifest
scripts/places.mjs         the place list and any hand-typed facts
scripts/<big-stage>.mjs    large stages split into their own module, imported lazily
public/data/*.json         committed outputs + manifest.json
video/storyboard.py        main film scenes; storyboard_<film>.py for supplements
video/render.py            the renderer (Film class)
video/sfx.py               synthesized sounds and music bed
video/stage/               stage.html/css/js (the framed "set") and vt.js (animation clock sync)
.devcontainer/             Node 22 container for app + pipeline
.github/workflows/deploy.yml  build + deploy to Pages, least privilege
README.md, ROADMAP.md
```

`package.json` scripts: `dev` → `vite`, `build` → `tsc --noEmit && vite build`, `preview`, `data` → `node scripts/fetch-data.mjs`.

---

## Part 4 – Look and feel

### 4.1 Mood

Dark, cinematic, glowing data on a near-black map. Frosted-glass UI floating over a full-bleed 3D map. Data *moves*: things flare, ripple, rise and cool. Serif display numbers give it an editorial, atlas-like feel; a mono face marks data values and ranges.

### 4.2 Design tokens (copy exactly)

```css
:root {
  --bg: #060a12;
  --glass: rgba(11, 17, 30, 0.74);
  --glass-strong: rgba(9, 14, 26, 0.9);
  --line: rgba(148, 170, 210, 0.14);
  --line-strong: rgba(148, 170, 210, 0.28);
  --ink: #e9eef7;
  --ink-2: #b4bfd2;
  --ink-3: #7d8aa3;
  --accent: #ff8a3d;          /* swap per project in 1.1 */
  --good: #3ecf8e;
  --radius: 14px;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  --font: 'Inter', system-ui, -apple-system, Segoe UI, sans-serif;
  --display: 'Fraunces', Georgia, serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  color-scheme: dark;
}
```

Fonts from Google Fonts: Inter 400/500/600/700, Fraunces (opsz 9–144, 500/700), JetBrains Mono 500. Base size 14px (13px under 820px). Bad = `#ff6b6b`. Links `#9cc7ff`.

**Per-element colour:** every layer, section and card sets `--c` to its own colour, and components use `color-mix(in srgb, var(--c) N%, transparent)` for tints, borders and glows. This is what makes each layer feel coloured without new CSS.

Fixed feature colours: Finder violet `#a99bff` / `#7b61ff`; deep finder teal→lime `#5eead4 → #a3e635 → #fde047`; place/"good" green `#3ecf8e`; sources cedar `#ffb86b`.

### 4.3 Typography roles

| Role | Style |
|---|---|
| Brand name | Fraunces 700, 26px |
| Panel title (h2) | Fraunces 700, 24px, line-height 1.15 |
| Big numbers (hero stats, year readout 34px, metric values 19px) | Fraunces 700, `tabular-nums` |
| Kicker above titles | 11px, uppercase, letter-spacing 1.4px, weight 600, colour `var(--c)` |
| Section heads (h3) | 12px uppercase, letter-spacing 1.1px, `--ink-3` |
| Lede | 13.5px, `--ink-2`, line-height 1.55 |
| Data values, ranges, axis labels | JetBrains Mono 10.5–11.5px |
| Notes, source lines | 11–11.5px `--ink-3` |

### 4.4 Screen layout (desktop)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ (◎) Atlas Name        [● Layer: Wildfires  +1 ▾]     [Deep finder][◎ Finder][Data & sources][▯] │
│     tagline                                                          ┌───────────┐ │
│                          ┌ toast ┐                                   │  panel    │ │
│                          └───────┘                                   │  380px    │ │
│                    full-bleed 3D map + vignette                      │  kicker   │ │
│                                                                      │  h2       │ │
│                                                                      │  lede     │ │
│                                                                      │  hero ×2  │ │
│                                                                      │  chart    │ │
│ ┌──────────────────────────── timeline (92px) ───────────────────┐   │  source   │ │
│ │ (▶)  1950   ▁▂▃▅▂▁▇▃ sparkline ◆ ◆ events  ━━━━●──────  Speed │   └───────────┘ │
│ └────────────────────────────────────────────────────────────────┘                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **App bar** top-left (14px/16px): spinning conic-gradient brand mark (38px ring, 18s spin, glow), name, tagline; then the **layer picker** — one pill button showing the focused layer's icon, a "LAYER" micro-label, its name, a `+N` badge for extra visible layers, and a chevron.
- **Top actions** top-right: pill buttons. The Finder button is violet-glowing (`.accent`); the deep finder has a teal-lime gradient; Data & sources has a tiny tree-ring icon; an icon button hides the panel (`P`).
- **Side panel** right, 380px, glass, `top: 72px`, scrolls; collapses with a fade + slide.
- **Timeline** bottom, glass, radius 18px, grid `52px 92px 1fr 92px`: round accent play button (pulses while playing), year + month readout, track (sparkline canvas 34px, event diamonds, range scrubber with glowing thumb and filled-to-here track, mono min/label/max), speed select (½, 1, 2, 4, 8 yr/s; default 2).
- **Toasts** top-centre, max 460px, coloured left bar, mono date, bold title, body.
- **Tooltip** follows the pointer (+14px), glass-strong, max 280px, key/value with mono values.
- **Map controls** moved left of the panel; restyled to glass with inverted icons.
- **Vignette** radial darkening over the map edges.
- **Loader** full-screen: spinning conic ring + one-line message ("Loading a century of … history…"), fades out over 0.8s.

**Responsive:** under 1100px the panel is 330px and the brand tagline hides. Under 820px: brand text hides, the layer menu becomes full-width fixed, Data & sources and panel buttons hide, only one toast shows, the panel docks above the timeline (max 34vh), the timeline spans the width without the speed control, and map controls hide.

### 4.5 Components

| Component | Recipe |
|---|---|
| `.glass` | `--glass` bg, `backdrop-filter: blur(14px) saturate(140%)`, 1px `--line` border, `--radius`, `--shadow` |
| `.pill-btn` | radius 999px, 8×14px padding, `--line-strong` border, glass bg, 600 weight 12.5px |
| Layer menu | 330px dropdown, glass-strong, grouped with uppercase group heads; rows = 28px tinted icon tile, name, mono year range, and a switch ("eye") to pin the layer on; focused row has a `--c` gradient and a glowing 3px left bar; ends with a hint line |
| Hero stats | 2-column grid of tiles: big Fraunces value, small label |
| Metric tile (reports) | label with coloured dot, Fraunces 19px value, 11px sub-line |
| Callout | 2px `--c` left border, faint bg, 12.5px |
| Chips | small pills; `.on` fills with `--c` at 25% |
| Legend / ramp | colour swatches; a 10px CSS gradient ramp with mono end labels |
| Source line | top border, 11px `--ink-3`, "Source: …" — every layer panel ends with one |
| Range bar | track + translucent band (10th–90th percentile) + white tick (median) + grey tick (today) |
| Projection badge | dashed `--c` border, hatched background, uppercase "Projection, not a record" |
| Static note | when a static layer is focused, the timeline greys out (opacity .16) and a centred note says it doesn't change over time and names its period |
| Rank list | rank number (mono), name + sub-line, gradient score bar (`#7b61ff → #3ecf8e`) with mono 0–100 |
| Switch | 34×19 track; checked = `--c` with glow; springy thumb |
| Modal | dimmed blurred backdrop, glass sheet ≤760px, Fraunces title |
| Close button | 28px square, top-right, `×` |

Charts (`charts.ts`): small d3 bar/line/scatter/stripes charts sized to the panel width, axis text `--ink-3` 10px, grid `--line`, and a **playhead** that tracks the timeline (`setPlayhead(t)`). Dashed lines for projections; muted lines for context series. Charts are created after the panel is in the DOM (one `requestAnimationFrame`).

### 4.6 Map visual idioms (deck.gl)

Pick one per layer in the brief:

| Idiom | How it works | Used for |
|---|---|---|
| **Flare then scar** | New items extrude and glow white-yellow→red with additive blending for a glow window tied to playback speed (`max(0.25, speed × 0.9)` years), then settle into a dim flat "scar" filtered by `DataFilterExtension` to `[start, time]` | fires, logging, construction, events with area |
| **Ripple at depth** | Points drawn at true depth (exaggerated ×3) with expanding surface shockwave rings | earthquakes, incidents |
| **Columns vs. normal** | `ColumnLayer` per station, height = value, colour = ratio to the station's own normal | river gauges, smoke days, counts |
| **Station colour** | Points/columns coloured on a diverging ramp (blue → grey → red) + warming-stripes chart | climate anomalies |
| **Surface** | Interpolated grid drawn to a bitmap, clipped to the outline, translucent, under labels; hatched for projections | hazard models, projections |
| **Place columns** | Extruded columns at each place, height/colour by the place metric; years interpolated between data points | population, prices, crime |
| **Glowing web** | Paths with additive glow, moving particles along them, routes coloured by effort | trails, roads, routes |
| **Beams** | Vertical columns of light sized by a real value | waterfalls, towers |
| **Map-wide haze** | Full-map tint whose strength follows a regional average for the year | smoke, drought |

Shared rules:

- Flat layers (ids matching `/scars|embers|base|stems/`) are re-inserted before the first basemap label layer; 3D columns stay on top.
- `NO_DEPTH` (`depthWriteEnabled: false, depthCompare: 'always'`) for overlays; an `ADDITIVE` blend preset for glows.
- Transitions on elevation/colour (~600ms, cubic-out) when values change.
- Data sorted by time once; `lowerBound()` slices the "active now" window each frame instead of filtering everything.

### 4.7 Basemap styling

- CARTO Dark Matter; hillshade from Terrarium DEM (exaggeration 0.55, shadow `#02040a`, highlight `rgba(150,175,215,.22)`, accent `#0b1424`, light from 315°) inserted **under the water layer** so the sea stays flat.
- Region outline as two lines: a wide blurred glow (`#4cc9f0`, width 10, blur 10, opacity .16) and a crisp line (`#8fdcff`, 0.8px, .5).
- Sky/fog: sky `#060a12`, horizon `#12233d`.
- Opening: start at a wide flat view, then `flyTo(HOME)` over 4.2s with curve 1.6 after the loader fades.
- `maxPitch: 75`, antialiasing on, compact attribution.

### 4.8 Motion

Menu in: 0.18s fade/slide down. Panel swap: fade + 6px rise. Toast in: 0.45s springy drop. Play button pulse ring. Brand mark slow spin. Selected place: a white ring pulsing out every 1.6s. Event beacons: three staggered expanding white rings over 3.5s. Respect `prefers-reduced-motion` for full-screen views.

---

## Part 5 – App architecture

### 5.1 The layer contract

Every layer is one factory in `layers.ts` returning:

```ts
export type Ctx = { time: number; speed: number; data: Data; selected: string | null; hovered: string | null; focusedId: string; clock: number };
export type AtlasEvent = { t: number; layer: string; title: string; body: string; lon?: number; lat?: number; zoom?: number };
export type PanelHandle = { update: (ctx: Ctx) => void };

export interface AtlasLayer {
  id: string; name: string; icon: string; color: string;
  range: [number, number];          // timeline span for this layer
  monthly?: boolean;                // arrow keys step a month instead of a year
  static?: boolean;                 // doesn't change over time (see 5.3)
  period?: string;                  // caption for a static layer, e.g. "1981–2010 average"
  available: boolean;               // false if its JSON is missing
  unavailable?: string;             // what to run to get it
  build: (ctx: Ctx) => Layer[];     // deck.gl layers for this moment
  spark: () => { x: number; y: number; color?: string }[];  // timeline sparkline
  events: () => AtlasEvent[];       // data-driven events (e.g. record years)
  panel: (el: HTMLElement, ctx: Ctx) => PanelHandle;         // story panel; update() ~every 90ms
  tooltip: (info: PickingInfo) => string | null;
  click?: (info: PickingInfo) => boolean;
}
```

Panel recipe for every layer: kicker (layer colour) → h2 → lede (what you're seeing, one or two sentences) → hero stats that update with time → one or two charts with a playhead → legend/ramp → callout for the key insight → note on caveats → source line. If unavailable: a dashed box saying which `npm run data <stage>` to run.

### 5.2 State and render loop

```ts
const state = {
  time, playing, speed,
  focused: 'base',            // the layer in the panel and picker
  timeLayer: '<first time layer>',  // owns the timeline; static layers leave it alone
  visible: new Set<string>(), // what's drawn
  pinned: new Set<string>(),  // switched on in the menu; survive picking another layer
  selected, hovered,          // place keys
  mode: 'layer' | 'place' | 'finder' | 'deep',
  ranked, beacons,
};
```

One `requestAnimationFrame` loop: advance time when playing (`dt × speed`, stop at the end of the range), fire events crossed since last frame (toast + beacon), `render()` (rebuild the deck layer list from visible layers + place pins/finder columns + selected ring + beacons), sync the timeline UI, update the panel every ~90ms.

### 5.3 Layer behaviour

- **Picking** a layer replaces the visible one; **pinned** layers stay. "Just the region" clears everything. The picker shows `+N` for extra visible layers.
- **Static layers**: focusing one dims the timeline with a note; the timeline keeps the last time-based layer's range, so pinned time layers keep animating underneath.
- **Place layers** draw their own columns, so plain place pins hide while one is visible. Some static layers draw place columns only while focused.
- **Events**: curated (`CURATED_EVENTS`) + each layer's `events()`. Diamonds on the track; click to jump (map flies to lon/lat/zoom). Crossing one during playback shows a toast and a beacon.
- **Hover** anything for a tooltip; **click** a place dot → Place Report.

### 5.4 Place Report and Finder

- `metrics.ts` computes a `PlaceMetrics` per place from all data (nearest station within a reach, counts within a radius since a year, trailing medians, interpolated years). Record *which* station/area a value came from and how far away, and show it.
- `CRITERIA`: `{ id, label, hint, value(t), higherIsBetter, defaultWeight }`.
- `rankPlaces()`: **percentile-rank each criterion across places** (ties share the average rank, flip if lower is better), then a weighted average over criteria the place has data for. Score 0–1, shown 0–100.
- Finder panel: violet kicker, the headline question, lede, sliders (0–5, label + hint), preset chips, ranked list, note on how scores work. Weights persist in `localStorage` under `<atlas-id>:weights` (wrapped in try/catch).
- On the map: ranked places as violet→mint columns (`#2b1f6b → #7dffc4`), top 5 brighter, top 10 labelled "1 · Name".
- Clicking a place flies there, shows the pulsing ring, opens its report; closing returns to the ranking.

### 5.5 Deep finder (if in the brief)

Left rail (360px, glass, slides in) + bottom **funnel** + right result list:

- Huge gradient count of matches at the top; preset chips ("Our brief", "Show everything").
- Collapsible sections, each with an icon tile in its colour; every slider sits on a **histogram of the items that value would let through given all the other filters** (kept bars glow in `--c`, cut range hatched).
- Funnel: one stage per section showing count after that step with a bar; the step that cuts the most is flagged "tightest"; the last stage glows.
- Matches glow on the map and rank by a score; cards show rank, title, badges, mini meters, score ring.
- Item report: hero + score ring, radar of strengths, arcs to the places it relies on, satellite toggle, links out, shortlist star with notes and asking price (localStorage).
- In deep mode the timeline, toasts, layer picker and panel button hide.

### 5.6 Data & sources view

Full-screen overlay (`S`, `#sources`): left = intro (kicker, big title, lede, stat row: sources, records, years covered) and the metaphor visual drawn on a canvas, with an animated year counter at its centre; right = 420px card list grouped by layer. Each card: colour bar, name, status from `manifest.json` (ok/failed, updated date), publisher, linked dataset title, what it gives, **a count read from the loaded data** ("**12,431** fire perimeters"), the endpoint in mono, licence pill, and "See it on the map →". Then a "What the atlas works out itself" list of derived figures, a licence summary and a "Copy citation" button.

### 5.7 Navigation and keys

`L` layer menu · `Space` play/pause · `←/→` step a year (or month) · `P` panel · `S` sources · `Esc` closes. Hashes: `#sources`, `#<deep-finder>`, `#<feature layer>`. Inputs never capture shortcuts. Right-drag or Ctrl-drag tilts/rotates.

### 5.8 Film handle

When loaded with `?film`, expose `window.<atlasId> = { map, state, data, layers, focus, openPlace, openFinder, openDeep, closeDeep, setPlaying, setTime, setPanelOpen, setMenu, showSources, HOME }` for the video renderer only.

---

## Part 6 – Data pipeline

`scripts/fetch-data.mjs` is a dictionary of **stages**, one per source:

```js
const SOURCES = {
  async base() { /* outline geometry → base.json */ },
  async fires() { /* fetch, clip to outline, simplify, quantize, writeOut('fires', …) */ },
  async places() { /* … */ },
  async deep() { const { buildDeep } = await import('./deep.mjs'); await buildDeep({ log, cached, writeOut, … }); },
};
const order = ['base', /* …stages that others read come first… */, 'deep'];
```

- `npm run data` runs all in order; `npm run data fires crime` runs some.
- Helpers: `cached(name, producer)` (raw responses in `.cache/`), `fetchBuf(url, { retries: 3, timeout })` with backoff, `fetchJSON`, `cachedJSON`, `pool(items, size, fn)` for polite concurrency, paged readers for the common APIs (WFS, OGC API), `writeOut(name, data)` (compact JSON + KB log).
- Clip everything to the region outline (`onRegion(lon, lat, tolerance)`), simplify geometry, round coordinates to 4 dp, store arrays-of-tuples for big point sets (`[lon, lat, t, size, cat]`), keep times as fractional years.
- Every output includes a `source` string (publisher, dataset, licence).
- **A failing stage never breaks the others**: it's logged, the old file stays, and `manifest.json` records `{ ok, updated, lastError, lastAttempt }`, which the sources view shows.
- Rate-limited services (routing, point-query APIs): batch, sleep between calls, cache each response.
- Big stages live in their own module and receive the helpers as arguments.
- Feeds that change seasonally (timetables) take the most common value over the next few weeks and fail with a clear message when the feed runs out.
- Acceptance: `rm -rf .cache && npm run data` completes and `npm run build` passes.

---

## Part 7 – Security, quality and deployment

- `esc()` / `safeUrl()` in `src/html.ts` for anything not a literal.
- Build-only CSP meta tag via a Vite plugin: `default-src 'self'; script-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; object-src 'none'; base-uri 'self'; form-action 'none'`.
- GitHub Pages workflow: `permissions: {}` at the top; build job `contents: read`, `persist-credentials: false`, Node 22, `npm ci`, `npm run build`, upload `dist`; deploy job alone gets `pages: write` + `id-token: write`.
- Optional: rulesets for owner-only pushes and a protected `main`, `CODEOWNERS`.
- Dev container: Node 22, curl, `npm ci` into a `node_modules` volume, port 5173, `ATLAS_WATCH_POLL` for file watching from Windows.
- `tsc --noEmit` must pass; the page must log no errors (the video renderer fails on page errors).

---

## Part 8 – The explainer video

A narrated, step-by-step **how-to** film, recorded from the real built app by script, so it can be re-rendered after any change to the app or data.

### 8.1 Rules for the film

- The narration says **what to click and where**, in order. It doesn't comment on what the data shows.
- Every click, drag, scroll and key press is real; the app responds for real.
- Deterministic: a virtual clock steps one frame at a time (Playwright fake clock + `vt.js`, which pins CSS/Web Animations to that clock), so every run gives the same film on any machine.
- Numbers said aloud come from the app's data (`facts()` reads them through the film handle; lines use `{name}` placeholders).
- **Master at 2560×1440, plus a 1920×1080 copy. Never 4K.** 30 fps.
- Re-render after `npm run data`.

### 8.2 The stage

`video/stage/stage.html` is a 1920×1080 "set":

- **Background**: slow aurora — three huge blurred blobs (teal `#1d6f8f`, violet `#5b3cc4`, ember `#c4612a`) drifting over faint generated contour lines (`#7fb4ff`, 22%) on a deep navy radial gradient.
- **Window**: the app in an iframe (1600×900) inside a floating browser window — rounded 16px, traffic-light dots, a URL pill showing the site address, a cool outer glow. The **camera** zooms and pans this window (Screen Studio-style): `"fill"` (app fills the frame), `"rest"` (window floats on the background), or a target element/region.
- In the window (zoom with it): a **cursor** (arrow and hand), click **ripples**, a **spotlight** that dims everything but a target, and **pins** (labels on map points).
- In the HUD (don't zoom): **title** (rises word by word out of a blur), **chapter tag** ("Step 3 of 9" + title, slides in from the left in the step colour), **chips** (on-screen hints: icon, "Drag", "to move the map"), **stats** cards, **end card** (logo spin-up, tagline, address, fine print), fades and blackout.

`Stage` API: `camera, cursorShow, cursorAt, cursorTo, mouse, press, point, rect, spot, pin, clearPins, fade, blackout, title, hideTitle, chapter, hideChapter, chip, hideChip, stats, hideStats, end, url`.

### 8.3 The `Film` API (used by scenes)

`wait(ms)`, `wait_until(js)`, `say(line_id)`, `voice_done(pad)`, `sfx(name, gain, …)`, `mark(name)`, `js(stage_expr, arg)`, `run(app_expr, arg)`, `camera(target, ms, whoosh=…)`, `cursor(on)`, `move(target, ms)`, `click(target)`, `drag(start, end, ms, button)`, `key(name)`, `scroll(dy, ms)`, `board(title, why)` (a storyboard frame: real screenshot + note).

Targets: `{"sel": css, "text": substring, "nth": i, "at": [fx, fy], "grow": px}` for an element, `{"lnglat": [lon, lat]}` for a map point, `{"cx", "cy", "z"}` for a camera view.

Scene helpers in the storyboard: `step(f, n, title, colour)` (chapter tag + whoosh), `hint(f, icon, head, body, colour)` (chip + blip), `spot/unspot`, `range_at` / `weight_at` (exact points on sliders), `open_menu_and_pick(f, name)`.

### 8.4 A scene

```python
dict(id="timeline", title="Play the timeline", run=timeline,
     shows="Play, speed, pause, dragging the slider, clicking an event marker.",
     camera="Zoomed on the timeline; full-frame for the event.",
     motion="Real clicks and a slider drag.",
     sound="Clicks.",
     lines={"time-1": "History layers play on the timeline. Click play, or press the space bar.",
            "time-2": "Use Speed to choose how many years pass each second."})
```

`run(f)` pattern: `step(...)` → `f.say(line)` → spotlight/hint → real moves and clicks → `f.board(...)` → `f.voice_done()` → next line.

### 8.5 Standard storyboard (adapt names)

| # | Scene | What happens |
|---|---|---|
| – | Intro | Black; title "How to use {Atlas}" rises; fade up on the app at HOME. Glassy note, music pad fades in. |
| 1 | Find your way around | Cursor touches a few place dots; spotlight walks: Layer button → top-right buttons → side panel → timeline. |
| 2 | Move the map | Drag, scroll-zoom, right-drag tilt/turn, zoom onto the map buttons (chips for each gesture). |
| 3 | Show a data layer | Zoom onto the menu; open Layer (or `L`); explain groups; pick the headline layer; panel updates. |
| 4 | Play the timeline | Play, change speed, pause, drag the slider, click an event diamond → map jumps, toast shows. |
| 5 | Switch, combine and clear | Pick another layer (replaces); flip a switch to keep one on; point at the `+1`; pick "Just the region". |
| 6 | Open a place's report | Hover a dot (name), click; map flies; scroll the report; close. |
| 7 | Rank places with the Finder | Open; drag one slider (ranking updates); click a preset; point at the columns; open a place; close twice. |
| 8 | Deep finder (if any) | Filters, the count, a slider, presets, open an item, shortlist, satellite, back, Shortlist tab, close. |
| 9 | See where the data comes from | Open sources; hover a source; "See it on the map". |
| 10 | Keyboard shortcuts | A chip for each key as it's pressed: L, Space, arrows, P, S, Esc. |
| – | End card | Window drifts back to rest; fade; soft impact; end card with tagline + address; "That's everything you need. Enjoy exploring."; blackout. |

Give each step its own colour (tour cyan `#4cc9f0`, map `#8fdcff`, layer = the layer's colour, place green `#3ecf8e`, finder violet `#a99bff`, deep finder teal `#5eead4`, sources cedar `#d8a06a`, keys amber `#ffb35c`). `STEPS` = the number of numbered scenes.

**Supplemental films** for big features (`video/storyboard_<film>.py`, `--film <film>`): same voice and style, line ids prefixed (e.g. `tw-`) so cached narration never clashes, 5–8 steps on just that feature and where it appears elsewhere (reports, finders).

### 8.6 Sound and voice

- **Voice**: Kokoro (`kokoro-onnx`) running locally, voice `af_heart`, speed 0.98. `spoken()` rewrites symbols for speech ("3D" → "three-D", "→" → "to"); a `SOUNDS` dict fixes mispronunciations at the phoneme level. Each line is cached by text hash in `video/out/vo/` and regenerated only when its text changes. A real recording at `video/out/vo/recorded/<line-id>.wav` replaces it and the picture retimes to fit.
- **Sound effects** (synthesized in `sfx.py`, no samples): `click`, `whoosh` (panned), `riser`, `impact`, `blip(note)`.
- **Music**: a synthesized ambient pad bed with reverb that **ducks under the voice**, fading in at the intro and out at the end.

### 8.7 Outputs (`video/out/`)

`<name>.mp4` (1440p, x264 slow CRF 17, BT.709 tagged), `<name>-1080p.mp4`, `storyboard.html` (every board frame with scene title, shows/camera/motion/sound, narration), `script.md` (line ids + text), `.srt` captions, `youtube.txt` (title, description with chapters timestamps and a link to the live site).

Commands:

```bash
.venv/Scripts/python.exe video/render.py --storyboard   # storyboard page, script, captions, YouTube text
.venv/Scripts/python.exe video/render.py --preview      # quick 960×540 cut with sound
.venv/Scripts/python.exe video/render.py                # 1440p master + 1080p copy
```

Options: `--only <scene ids>`, `--start <scene>`, `--stills 10,60`, `--url`, `--no-build`, `--video-only`, `--film <name>`. The renderer builds the app, serves `dist/` locally, opens the stage in Edge, and fails if the page logs errors.

---

## Part 9 – Build order for Claude

Do one milestone at a time; each ends with `npm run build` passing and the app checked in the browser.

1. **Scaffold**: Vite + TS, `index.html` shell, `style.css` tokens and components (Part 4), map with basemap, hillshade, outline glow, loader and intro flight. Empty layer menu with "Just the region". Place dots with tooltips.
2. **Pipeline skeleton**: `fetch-data.mjs` helpers, `base` and `places` stages, manifest. Prove from an empty cache.
3. **First time layer** end to end: stage → JSON → `AtlasLayer` (map, sparkline, panel with chart + playhead, tooltip) → timeline play/scrub/speed/keys.
4. **Events**: curated + data-driven, diamonds, toasts, beacons.
5. **Remaining layers** from the brief, one per step; static-layer support when the first static one arrives; pinning and `+N`.
6. **Place Report** (metrics) → **Place Finder** (criteria, ranking, presets, columns, localStorage).
7. **Data & sources** view with the chosen metaphor.
8. **Deep finder** (if in the brief).
9. **Security and deploy**: `esc`/`safeUrl` audit, CSP plugin, Pages workflow, dev container.
10. **README** (features table, tech, getting started, refreshing data, deploying, the video, data sources table, caveats) and **ROADMAP** (suggested build order table with effort, ✅ for built items, *(verify)* on unconfirmed sources, "Still open" lists).
11. **Explainer film**: stage, `vt.js`, `render.py`, `sfx.py`, `storyboard.py` with the standard scenes; render `--storyboard`, then `--preview`, then the 1440p master.

## Part 10 – Done checklist

- [ ] Opens on just the region; intro flight; no console errors.
- [ ] Every layer has map visuals, a sparkline (or static note), a full panel with a source line, and tooltips.
- [ ] Projections and estimates are visibly marked; ranges shown for model output.
- [ ] Place Report covers every layer that has a per-place meaning; Finder ranks with percentile scoring and saves weights.
- [ ] Sources view counts records from the loaded data and shows pipeline status.
- [ ] `rm -rf .cache && npm run data` works with no manual steps; a broken source doesn't break the rest.
- [ ] All outside text escaped; CSP present in the build; deploy workflow least-privilege.
- [ ] Usable at phone width (panel docks above the timeline).
- [ ] Film renders at 1440p + 1080p with storyboard, script, captions and YouTube text; narration only says where to click.
