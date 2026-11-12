# Roadmap

Ported from Manitoulin Atlas on 2026-11-11; the blueprint is `MAP-ATLAS-BLUEPRINT.md`.

| # | Milestone (blueprint Part 9) | Effort | Status |
|---|---|---|---|
| 1 | Scaffold: Vite + TS, shell, design system, map, hillshade, lake outline glow, intro flight | S | ✅ |
| 2 | Pipeline: helpers, `base` (Upper + Lower Arrow Lake), `places`, manifest, Overpass mirrors | S | ✅ |
| 3 | Headline time layer: Arrow Lakes Reservoir levels, with pre-dam gauges | M | ✅ |
| 4 | Events: data-driven (record high/low, poorest refill, worst fire years) + curated (Columbia River Treaty, Keenleyside, Mica, Revelstoke dams, R. v. Desautel) | S | ✅ |
| 5 | Remaining layers: wildfires, climate, quakes, population, homes, health, getting around, hikes, valley life | L | ✅ |
| 6 | Place Report + Place Finder | M | ✅ |
| 7 | Data & sources view (drawdown-bank sediment cores) | M | ✅ |
| 8 | Deep finder | L | ⏳ no open parcel data (see below) |
| 9 | Security and deploy: `esc`/`safeUrl`, CSP, Pages workflow, dev container | S | ✅ live at https://dtomyn.github.io/ArrowLakes-Discovery/ |
| 10 | README + ROADMAP | S | ✅ |
| 11 | Explainer film | L | ⏳ not ported yet (Manitoulin's `video/` can be adapted) |

## Still open

- **Pre-dam levels in metres above sea level** — the 1922–1969 gauges use local datums; a published datum offset would let the natural lake sit on the same 3D scale as the reservoir. *(verify)*
- **Lower Arrow Lake levels** — Fauquier fills gaps in the Nakusp series; a separate Lower Arrow surface would show the slope between the lakes.
- **Emergency department hours** — Interior Health posts service changes but no open feed; the health layer says to check. *(verify)*
- **Ferry schedules** — BC inland ferry timetables have no open feed; the app names the ferries and says to check sailings. *(verify)*
- **Property sales / listings** — BC Assessment and MLS data aren't openly licensed. A deep "Lot Finder" needs open parcel data (ParcelMap BC's open parcel fabric could be a start).
- **Flood and erosion lines** — BC Hydro's reservoir flowage and safety lines aren't published as open data that we could find.
- **Snowpack** — BC River Forecast Centre snow pillows (open) would make a strong winter layer and explain the reservoir's refill.
- **Wildfire risk** — BC's Provincial Strategic Threat Analysis rasters could add a static fire-threat surface.
- **Sinixt place names** — a layer of Sinixt place names, with the Nation's permission.
