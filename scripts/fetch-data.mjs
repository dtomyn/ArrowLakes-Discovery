#!/usr/bin/env node
// Arrow Lakes Atlas data pipeline.
// Pulls open data for the Arrow Lakes valley (West Kootenay, British Columbia) from public APIs,
// clips it to the valley (or a wider southern-interior box where that matters) and writes compact
// JSON to public/data/ for the static app.
//
//   node scripts/fetch-data.mjs                 # every stage
//   node scripts/fetch-data.mjs water fires     # selected stages
//
// Raw downloads are cached in .cache/ so re-runs are quick; delete it to refresh everything.
// A failing stage never breaks the others: its old file stays and manifest.json records the error.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import simplify from '@turf/simplify';
import { CSDS, PLACES, DESTINATIONS } from './places.mjs';
import { buildTrails } from './trails.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache');

// Box around the Arrow Lakes valley, Revelstoke to Castlegar (lon/lat), and a wider southern
// interior box for earthquakes. CLIMATE_BOX picks the long-running stations around the lakes.
const BBOX = { west: -118.45, south: 49.2, east: -117.45, north: 51.05 };
const WIDE = { west: -121.0, south: 47.8, east: -114.5, north: 52.6 };
const CLIMATE_BOX = { west: -118.9, south: 48.95, east: -116.85, north: 51.4 };
// Wider box for hospitals and regional destinations people actually drive to (Trail, Nelson, Vernon, Kelowna).
const CARE_BOX = { west: -119.7, south: 48.95, east: -117.0, north: 51.15 };
const OSM_LAKES = [2198542, 2198541]; // Upper Arrow Lake, Lower Arrow Lake (natural=water)
// The valley: within this many km of the lakeshore, or of a community in the atlas.
const REACH_SHORE = 12, REACH_PLACE = 8;
const OGC = 'https://api.weather.gc.ca/collections';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const BCWFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs';
const UA = 'ArrowLakesAtlas/0.1 (open-data atlas; personal research)';
const OGL = 'Open Government Licence – Canada';
const OGLBC = 'Open Government Licence – British Columbia';
const ODBL = 'ODbL 1.0 © OpenStreetMap contributors';

// ---------------------------------------------------------------------------------------------
// helpers

const log = (...a) => console.log('·', ...a);
const round = (v, d = 4) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function distKm(aLon, aLat, bLon, bLat) {
  const r = Math.PI / 180;
  const s = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

async function cached(name, producer) {
  const file = path.join(CACHE, name);
  try {
    return await fs.readFile(file);
  } catch {
    const buf = await producer();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
    return buf;
  }
}

async function fetchBuf(url, { retries = 5, timeout = 180_000, init = {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeout), ...init, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 160)}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(2500 * attempt);
    }
  }
}

const cachedText = async (name, url, opts) => (await cached(name, () => fetchBuf(url, opts))).toString('utf8');
const cachedJSON = async (name, url, opts) => JSON.parse(await cachedText(name, url, opts));

/** Overpass with fallback mirrors: a busy server answers 502/504 or a "runtime error" remark. */
async function overpass(name, query) {
  return JSON.parse((await cached(name, async () => {
    let last;
    for (let r = 0; r < 2; r++)
      for (const url of OVERPASS) {
        try {
          const buf = await fetchBuf(url, { retries: 1, timeout: 240_000, init: { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } });
          let j;
          try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('busy (not JSON)'); }
          if (!Array.isArray(j.elements) || /runtime error|timed out|out of memory/i.test(j.remark ?? '')) throw new Error(`busy (${j.remark ?? 'no elements'})`);
          return buf;
        } catch (e) { last = e; log(`  overpass ${name}: ${e.message}, trying another server`); await sleep(5000); }
      }
    throw last;
  })).toString('utf8'));
}

async function writeOut(name, data) {
  await fs.mkdir(OUT, { recursive: true });
  const text = JSON.stringify(data);
  await fs.writeFile(path.join(OUT, `${name}.json`), text);
  log(`wrote ${name}.json (${(text.length / 1024).toFixed(0)} KB)`);
}

async function readOut(name) {
  try { return JSON.parse(await fs.readFile(path.join(OUT, `${name}.json`), 'utf8')); } catch { return null; }
}

/** Page through an MSC GeoMet OGC API collection. */
async function ogcAll(collection, params, cacheKey) {
  const features = [];
  const limit = 10000;
  for (let offset = 0; ; offset += limit) {
    const q = new URLSearchParams({ f: 'json', limit: String(limit), offset: String(offset), ...params });
    const page = await cachedJSON(`ogc/${cacheKey}-${offset}.json`, `${OGC}/${collection}/items?${q}`);
    features.push(...page.features);
    if (page.features.length < limit) break;
  }
  return features;
}

/** Page through a DataBC WFS layer inside a lon/lat box (GeoJSON in EPSG:4326). */
async function bcWfsAll(typeName, box, cacheKey) {
  const features = [];
  const count = 1000;
  for (let start = 0; ; start += count) {
    const q = new URLSearchParams({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName: `pub:${typeName}`, outputFormat: 'application/json',
      srsName: 'EPSG:4326', count: String(count), startIndex: String(start), sortBy: 'OBJECTID',
      bbox: `${box.south},${box.west},${box.north},${box.east},urn:ogc:def:crs:EPSG:4326`,
    });
    const page = await cachedJSON(`bcwfs/${cacheKey}-${start}.json`, `${BCWFS}?${q}`);
    features.push(...(page.features ?? []));
    if ((page.features ?? []).length < count) break;
  }
  return features;
}

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, commas inside quotes). */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const yearFrac = (iso) => {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  return y + (d - Date.UTC(y, 0, 1)) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1));
};

const roundCoords = (g) => JSON.parse(JSON.stringify(g, (k, v) => (typeof v === 'number' ? round(v, 4) : v)));

// ---------------------------------------------------------------------------------------------
// the lakes: OpenStreetMap's Upper and Lower Arrow Lake polygons (full-pool shoreline, simplified)

let lakes;
async function getLakes() {
  if (lakes) return lakes;
  const res = await cachedJSON(
    'osm/lakes-nominatim.json',
    `https://nominatim.openstreetmap.org/lookup?osm_ids=${OSM_LAKES.map((r) => `R${r}`).join(',')}&format=json&polygon_geojson=1`,
  );
  const polys = [];
  for (const r of res) {
    const g = r.geojson;
    if (!g) continue;
    const s = simplify({ type: 'Feature', properties: {}, geometry: g }, { tolerance: 0.0006, highQuality: true });
    const gs = s.geometry.type === 'Polygon' ? [s.geometry.coordinates] : s.geometry.type === 'MultiPolygon' ? s.geometry.coordinates : [];
    // outer shorelines only: islands in the reservoir are small and come and go with the water
    for (const p of gs) polys.push([p[0]]);
  }
  if (!polys.length) throw new Error('Nominatim returned no outline for the Arrow Lakes');
  lakes = { type: 'Feature', properties: { name: 'Arrow Lakes' }, geometry: roundCoords({ type: 'MultiPolygon', coordinates: polys }) };
  return lakes;
}

/** Distance in km from a point to the Arrow Lakes shoreline (0 on the water). */
function kmToShore(lon, lat) {
  const rings = lakes.geometry.coordinates.map((p) => p[0]);
  let best = Infinity, inside = false;
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
      if (ay > lat !== by > lat && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
      const px = (lon - ax) * kx, py = (lat - ay) * ky, vx = (bx - ax) * kx, vy = (by - ay) * ky;
      const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy || 1)));
      best = Math.min(best, Math.hypot(px - t * vx, py - t * vy));
    }
  return inside ? 0 : best;
}

/** In the valley the atlas covers: near the lakeshore, or near one of its communities. */
const onRegion = (lon, lat) =>
  lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north &&
  (PLACES.some((p) => distKm(p.lon, p.lat, lon, lat) <= REACH_PLACE) || kmToShore(lon, lat) <= REACH_SHORE);

// ---------------------------------------------------------------------------------------------
// stages

const SOURCES = {
  async base() {
    const f = await getLakes();
    f.properties.source = `OpenStreetMap relations ${OSM_LAKES.join(' and ')} via Nominatim (${ODBL})`;
    await writeOut('base', f);
  },

  async places() {
    await getLakes();
    const csdBy = Object.fromEntries(CSDS.map((c) => [c.csd, c]));
    const places = PLACES.map((p) => ({
      ...p,
      csdName: csdBy[p.csd].short ?? csdBy[p.csd].name,
      coastKm: round(kmToShore(p.lon, p.lat), 2),
    }));
    for (const p of places) log(`  ${p.name}: ${p.coastKm} km to the lakeshore`);
    await writeOut('places', { places, csds: CSDS, source: 'Place points from OpenStreetMap; census subdivisions from Statistics Canada (2021)' });
  },

  // Statistics Canada table 17-10-0155-01: population estimates, July 1, by CSD (2021 boundaries).
  async population() {
    const zip = await cached('statcan/17100155-eng.zip', () => fetchBuf('https://www150.statcan.gc.ca/n1/tbl/csv/17100155-eng.zip'));
    const files = unzipSync(new Uint8Array(zip));
    const name = Object.keys(files).find((n) => /^17100155\.csv$/.test(n));
    const rows = parseCSV(strFromU8(files[name]).replace(/^﻿/, ''));
    const head = rows[0];
    const iY = head.indexOf('REF_DATE'), iG = head.indexOf('DGUID'), iV = head.indexOf('VALUE');
    const want = new Set(CSDS.map((c) => c.csd));
    const out = {};
    for (const r of rows.slice(1)) {
      const code = r[iG]?.slice(-7);
      if (!want.has(code) || r[iV] === '') continue;
      (out[code] ??= {})[r[iY]] = +r[iV];
    }
    const missing = CSDS.filter((c) => !out[c.csd]).map((c) => c.name);
    if (missing.length) log(`  no estimates for: ${missing.join(', ')}`);
    await writeOut('population', {
      source: `Statistics Canada, Table 17-10-0155-01 Population estimates, July 1, by census subdivision, 2021 boundaries (${OGL})`,
      csds: out,
    });
  },

  // 2021 Census Profile per CSD through Statistics Canada's SDMX web service.
  async census() {
    const CHAR = { pop21: 1, pop16: 2, dwellings: 4, area: 7, medAge: 40, s65: 37, income: 229, owners: 1401, shelter: 1472, value: 1474, avgValue: 1475 };
    const out = {};
    for (const c of CSDS) {
      const url = `https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest/data/STC_CP,DF_CSD/A5.2021A0005${c.csd}.1..1?format=csv`;
      const text = await cachedText(`statcan/cp2021-${c.csd}.csv`, url, { init: { headers: { Accept: 'application/vnd.sdmx.data+csv', 'Accept-Language': 'en' } } });
      const rows = parseCSV(text);
      const h = rows[0], iC = h.indexOf('CHARACTERISTIC'), iV = h.indexOf('OBS_VALUE');
      const by = new Map(rows.slice(1).map((r) => [+r[iC], r[iV]]));
      const rec = {};
      for (const [k, id] of Object.entries(CHAR)) {
        const v = by.get(id);
        rec[k] = v === '' || v == null ? null : +v;
      }
      if (rec.s65 != null) rec.s65 = round(rec.s65 / 100, 3);
      out[c.csd] = rec;
      log(`  ${c.name}: pop ${rec.pop21}, median value ${rec.value ?? '—'}`);
      await sleep(250);
    }
    await writeOut('census', { source: `Statistics Canada, 2021 Census of Population, Census Profile by census subdivision (${OGL})`, csds: out });
  },

  // HYDAT monthly mean water levels. Since the Hugh Keenleyside Dam closed in 1968 the lakes are one
  // reservoir, gauged at Nakusp and Fauquier in metres above sea level. Before it, gauges at Nakusp
  // and Needles read the natural lakes against local datums, so those are kept as their own series.
  async water() {
    const STATIONS = [
      { id: '08NE104', lake: 'reservoir' }, { id: '08NE102', lake: 'reservoir' },
      { id: '08NE045', lake: 'natural' }, { id: '08NE046', lake: 'natural' },
    ];
    const stations = [];
    for (const { id, lake } of STATIONS) {
      const m = (await ogcAll('hydrometric-stations', { STATION_NUMBER: id }, `hydro-station-${id}`))[0];
      const feats = await ogcAll('hydrometric-monthly-mean', { STATION_NUMBER: id, sortby: 'DATE' }, `hydro-monthly-${id}`);
      const months = {};
      for (const f of feats) if (f.properties.MONTHLY_MEAN_LEVEL != null) months[f.properties.DATE] = round(f.properties.MONTHLY_MEAN_LEVEL, 3);
      const keys = Object.keys(months).sort();
      log(`  ${id} ${m?.properties.STATION_NAME}: ${keys.length} months ${keys[0]}–${keys.at(-1)}`);
      if (!keys.length || !m) continue;
      stations.push({ id, name: titleCase(m.properties.STATION_NAME), lon: round(m.geometry.coordinates[0]), lat: round(m.geometry.coordinates[1]), lake, months });
    }
    await writeOut('water', {
      source: `Environment and Climate Change Canada, HYDAT national water data archive: monthly mean water levels (${OGL})`,
      datum: 'reservoir gauges: metres above sea level (geodetic); pre-dam gauges: metres above each gauge’s own local datum',
      stations,
    });
  },

  // BC Wildfire Service fire perimeters: every mapped fire since 1919 (historical layer) plus this
  // season's fires (current layer), inside the valley box. Simplified to ~80 m, coordinates to 4 dp.
  async fires() {
    const hist = await bcWfsAll('WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP', BBOX, 'fires-historical');
    let cur = [];
    try { cur = await bcWfsAll('WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP', BBOX, 'fires-current'); }
    catch (e) { log(`  current-season fires unavailable: ${e.message}`); }
    const seen = new Set();
    const rows = [];
    const CAUSE = (c) => (/lightning/i.test(c ?? '') ? 0 : /person|human/i.test(c ?? '') ? 1 : 2);
    for (const f of [...cur, ...hist]) {
      const p = f.properties ?? {};
      const year = +p.FIRE_YEAR;
      if (!year || !f.geometry) continue;
      const id = `${year}-${p.FIRE_NUMBER}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const ha = +p.FIRE_SIZE_HECTARES || (p.FEATURE_AREA_SQM ? p.FEATURE_AREA_SQM / 1e4 : 0);
      const date = p.FIRE_DATE ?? p.TRACK_DATE ?? null;
      // no start date: put it at the height of the fire season (mid-July)
      let t = date ? yearFrac(date) : year + 0.54;
      if (Math.floor(t) !== year) t = year + 0.54;
      const s = simplify(f, { tolerance: ha > 2000 ? 0.0012 : 0.0007, highQuality: false });
      const g = s.geometry.type === 'Polygon' ? [s.geometry.coordinates] : s.geometry.type === 'MultiPolygon' ? s.geometry.coordinates : [];
      const polys = g.map((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x), round(y)]))).filter((poly) => poly[0]?.length >= 4);
      const all = polys.flatMap((poly) => poly[0]);
      if (!all.length) continue;
      const cx = all.reduce((a, c) => a + c[0], 0) / all.length, cy = all.reduce((a, c) => a + c[1], 0) / all.length;
      rows.push({ t: round(t, 3), ha: round(ha, 1), c: CAUSE(p.FIRE_CAUSE), n: p.FIRE_LABEL ?? id, x: round(cx), y: round(cy), g: ha >= 5 ? polys : [] });
    }
    rows.sort((a, b) => a.t - b.t);
    const byY = rows.reduce((a, r) => ((a[Math.floor(r.t)] = (a[Math.floor(r.t)] ?? 0) + r.ha), a), {});
    const big = Object.entries(byY).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([y, v]) => `${y} ${Math.round(v)} ha`);
    log(`  ${rows.length} fires ${Math.floor(rows[0]?.t)}–${Math.floor(rows.at(-1)?.t)} (${cur.length} from the current season); biggest years: ${big.join(', ')}`);
    await writeOut('fires', {
      source: `BC Wildfire Service, Fire Perimeters – Historical and Current, via the BC Data Catalogue (${OGLBC})`,
      box: BBOX,
      rows,
    });
  },

  // AHCCD: Environment Canada's adjusted and homogenized annual temperatures around the lakes.
  async climate() {
    const box = `${CLIMATE_BOX.west},${CLIMATE_BOX.south},${CLIMATE_BOX.east},${CLIMATE_BOX.north}`;
    const st = await ogcAll('ahccd-stations', { bbox: box }, 'ahccd-stations');
    const temp = st.filter((f) => f.properties.measurement_type__type_mesure === 'temp_mean');
    const stations = [];
    for (const f of temp) {
      const id = f.properties.station_id__id_station;
      const rows = await ogcAll('ahccd-annual', { station_id__id_station: id, period_value__valeur_periode: 'Ann' }, `ahccd-annual-${id}`);
      const series = {};
      for (const r of rows) {
        const v = r.properties.temp_mean__temp_moyenne;
        if (v != null && v > -100) series[r.properties.year__annee] = round(v, 2);
      }
      const base = Object.entries(series).filter(([y]) => +y >= 1961 && +y <= 1990).map(([, v]) => v);
      if (Object.keys(series).length < 30 || base.length < 20) continue;
      const [lon, lat] = f.geometry.coordinates;
      stations.push({ id, name: titleCase(f.properties.station_name__nom_station.replace(/_/g, ' ')), lon: round(lon), lat: round(lat), baseline: round(base.reduce((a, b) => a + b, 0) / base.length, 2), temp: series, km: round(distKm(-117.9, 50.0, lon, lat), 0) });
      log(`  ${id} ${f.properties.station_name__nom_station}: ${Object.keys(series).length} years`);
    }
    stations.sort((a, b) => a.km - b.km);
    await writeOut('climate', { source: `Environment and Climate Change Canada, Adjusted and Homogenized Canadian Climate Data (AHCCD), annual mean temperature (${OGL})`, baselinePeriod: '1961–1990', stations });
  },

  // "What it feels like": this atlas's own 30-year averages of monthly records at Castlegar airport
  // (south end) and Nakusp (mid-lake), over each station's latest 30 years with good coverage.
  async normals() {
    const WANT = [{ id: '1141455', name: 'Castlegar Airport' }, { id: '1145297', name: 'Nakusp' }];
    const F = { tMean: 'MEAN_TEMPERATURE', tMax: 'MAX_TEMPERATURE', tMin: 'MIN_TEMPERATURE', precip: 'TOTAL_PRECIPITATION', snow: 'TOTAL_SNOWFALL', wetDays: 'DAYS_WITH_PRECIP_GE_1MM' };
    const out = [];
    for (const w of WANT) {
      const feats = await ogcAll('climate-monthly', { CLIMATE_IDENTIFIER: w.id, sortby: 'LOCAL_DATE' }, `climate-monthly-${w.id}`);
      if (!feats.length) { log(`  ${w.name}: no monthly records`); continue; }
      const good = feats.filter((f) => f.properties.MEAN_TEMPERATURE != null && f.properties.DAYS_WITH_VALID_MEAN_TEMP >= 25);
      const Y1 = Math.max(...good.map((f) => f.properties.LOCAL_YEAR)) - 1, Y0 = Y1 - 29;
      const acc = Object.fromEntries(Object.keys(F).map((k) => [k, Array.from({ length: 12 }, () => [])]));
      let p0 = null;
      for (const f of feats) {
        const p = f.properties;
        if (p.LOCAL_YEAR < Y0 || p.LOCAL_YEAR > Y1) continue;
        p0 ??= p;
        for (const [k, col] of Object.entries(F)) {
          const v = p[col];
          // only months with (nearly) every day reported
          const days = k === 'snow' ? p.DAYS_WITH_VALID_SNOWFALL : k === 'precip' || k === 'wetDays' ? p.DAYS_WITH_VALID_PRECIP : k === 'tMax' ? p.DAYS_WITH_VALID_MAX_TEMP : k === 'tMin' ? p.DAYS_WITH_VALID_MIN_TEMP : p.DAYS_WITH_VALID_MEAN_TEMP;
          if (v != null && days >= 25) acc[k][p.LOCAL_MONTH - 1].push(v);
        }
      }
      if (!p0) continue;
      const mean = (xs) => (xs.length >= 8 ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 1) : null);
      const monthly = Object.fromEntries(Object.entries(acc).map(([k, ms]) => [k, ms.map(mean)]));
      const sumOf = (xs) => (xs.every((x) => x != null) ? round(xs.reduce((a, b) => a + b, 0), 0) : null);
      const annual = { precip: sumOf(monthly.precip), snow: sumOf(monthly.snow), wetDays: sumOf(monthly.wetDays), tMean: monthly.tMean.every((x) => x != null) ? round(monthly.tMean.reduce((a, b) => a + b, 0) / 12, 1) : null };
      const years = Object.fromEntries(Object.entries(acc).map(([k, ms]) => [k, Math.min(...ms.map((m) => m.length))]));
      out.push({ id: w.id, name: w.name, lon: round(+p0.LONGITUDE), lat: round(+p0.LATITUDE), period: `${Y0}–${Y1}`, monthly, annual, years });
      log(`  ${w.name} ${Y0}–${Y1}: annual ${JSON.stringify(annual)}`);
    }
    if (!out.length) throw new Error('no monthly climate records for Castlegar or Nakusp');
    await writeOut('normals', { source: `Environment and Climate Change Canada, monthly climate summaries for ${out.map((s) => `${s.name} (${s.id})`).join(' and ')}, averaged here over 30 years (${OGL})`, stations: out });
  },

  // NRCan's national earthquake catalogue, wider southern-interior box. Blasts are labelled in the
  // catalogue, so they're kept and marked rather than mixed in.
  async quakes() {
    const q = new URLSearchParams({ starttime: '1900-01-01', minlatitude: WIDE.south, maxlatitude: WIDE.north, minlongitude: WIDE.west, maxlongitude: WIDE.east, minmagnitude: '1.5', format: 'text' });
    const text = await cachedText('nrcan/quakes.txt', `https://earthquakescanada.nrcan.gc.ca/fdsnws/event/1/query?${q}`);
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const [, time, lat, lon, depth, , mag, place] = line.split('|');
      if (!mag || !lat) continue;
      const name = (place ?? '').split('/')[0].trim();
      const kind = /blast|mining|mine|quarry|explosion|rockburst/i.test(name) ? 1 : 0;
      rows.push([round(+lon, 3), round(+lat, 3), round(+depth || 0, 1), round(+mag, 1), round(yearFrac(time), 4), name, kind]);
    }
    rows.sort((a, b) => a[4] - b[4]);
    log(`  ${rows.length} events (${rows.filter((r) => r[6] === 0).length} natural)`);
    await writeOut('quakes', { source: `Natural Resources Canada, Earthquakes Canada national earthquake database (${OGL})`, box: WIDE, rows });
  },

  // OpenStreetMap: everyday services, places to enjoy, named trails, the inland ferries, airports
  // and the hospitals people drive to.
  async osm() {
    await getLakes();
    const bb = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
    const q = `[out:json][timeout:200];(
      nwr[amenity~"^(hospital|clinic|doctors|pharmacy|school|library|fuel|restaurant|cafe|community_centre|townhall)$"](${bb});
      nwr[shop~"^(supermarket|convenience|general|hardware|bakery)$"](${bb});
      nwr[leisure~"^(marina|golf_course|nature_reserve|slipway)$"](${bb});
      nwr[natural~"^(beach|hot_spring)$"](${bb});
      nwr[amenity=public_bath]["bath:type"~"hot_spring|thermal"](${bb});
      nwr[waterway=waterfall](${bb});
      nwr[tourism~"^(camp_site|museum|viewpoint|attraction|gallery)$"](${bb});
      nwr[aeroway=aerodrome](${bb});
    );out center tags;`;
    const res = await overpass('osm/pois.json', q);
    const CAT = (t) =>
      t.amenity === 'hospital' ? 'hospital' : t.amenity === 'clinic' || t.amenity === 'doctors' ? 'clinic' : t.amenity === 'pharmacy' ? 'pharmacy'
      : t.shop === 'supermarket' ? 'grocery' : t.shop === 'convenience' || t.shop === 'general' || t.shop === 'bakery' ? 'store' : t.shop === 'hardware' ? 'store'
      : t.amenity === 'school' ? 'school' : t.amenity === 'library' ? 'library' : t.amenity === 'fuel' ? 'fuel'
      : t.amenity === 'restaurant' || t.amenity === 'cafe' ? 'food' : t.amenity === 'community_centre' || t.amenity === 'townhall' ? 'civic'
      : t.natural === 'hot_spring' || t.amenity === 'public_bath' ? 'hotspring'
      : t.leisure === 'marina' || t.leisure === 'slipway' ? 'marina' : t.leisure === 'golf_course' ? 'golf' : t.leisure === 'nature_reserve' ? 'nature'
      : t.natural === 'beach' ? 'beach' : t.waterway === 'waterfall' ? 'waterfall'
      : t.tourism === 'camp_site' ? 'camp' : t.tourism === 'viewpoint' ? 'viewpoint' : t.tourism === 'museum' || t.tourism === 'gallery' ? 'museum'
      : t.tourism === 'attraction' ? 'attraction' : t.aeroway === 'aerodrome' ? 'airport' : null;
    const pois = [];
    for (const e of res.elements) {
      const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat, t = e.tags ?? {};
      const cat = /hot\s?springs?$/i.test(t.name ?? '') ? 'hotspring' : CAT(t);
      if (lon == null || !cat || !onRegion(lon, lat)) continue;
      // hot springs are often mapped twice (the spring and the resort's pool): keep one per 300 m
      if (cat === 'hotspring' && pois.some((p) => p[2] === 'hotspring' && distKm(p[0], p[1], lon, lat) < 0.3)) continue;
      pois.push([round(lon), round(lat), cat, t.name ? t.name.replace(/_/g, ' ') : null]);
    }

    // hiking routes and named trails, with geometry
    const tq = `[out:json][timeout:200];(
      rel[route=hiking](${bb});
      way[highway~"^(path|footway|track)$"][name](${bb});
    );out geom tags;`;
    const tr = await overpass('osm/trails.json', tq);
    const trails = [];
    const seenWays = new Set();
    for (const e of tr.elements.filter((x) => x.type === 'relation')) {
      const parts = (e.members ?? []).filter((m) => m.type === 'way' && m.geometry).map((m) => { seenWays.add(m.ref); return m.geometry.map((g) => [round(g.lon), round(g.lat)]); });
      const mid = parts[0]?.[parts[0].length >> 1];
      if (parts.length && mid && onRegion(mid[0], mid[1])) trails.push({ name: e.tags?.name ?? 'Hiking route', km: round(lengthKm(parts), 1), parts, route: true });
    }
    const byName = {};
    for (const e of tr.elements.filter((x) => x.type === 'way' && !seenWays.has(x.id) && x.geometry)) {
      const mid = e.geometry[e.geometry.length >> 1];
      if (onRegion(mid.lon, mid.lat)) (byName[e.tags.name] ??= []).push(e.geometry.map((g) => [round(g.lon), round(g.lat)]));
    }
    for (const [name, parts] of Object.entries(byName)) {
      const km = lengthKm(parts);
      if (km >= 0.4 && !/road|rd\b|street|st\b|drive|lane|line\b|avenue|fsr\b|forest service/i.test(name)) trails.push({ name, km: round(km, 1), parts, route: false });
    }

    // the inland ferries (free, run by the province) and the hospitals in the wider care box
    const fq = `[out:json][timeout:120];way[route=ferry](${bb});out geom tags;`;
    const fr = await overpass('osm/ferry.json', fq);
    const ferry = fr.elements.filter((e) => e.geometry?.length > 1).map((e) => ({ name: e.tags?.name ?? 'Ferry', path: e.geometry.map((g) => [round(g.lon), round(g.lat)]), km: round(lengthKm([e.geometry.map((g) => [g.lon, g.lat])]), 1) }));
    const cb = `${CARE_BOX.south},${CARE_BOX.west},${CARE_BOX.north},${CARE_BOX.east}`;
    const hq = `[out:json][timeout:90];nwr[amenity=hospital](${cb});out center tags;`;
    const hr = await overpass('osm/hospitals.json', hq);
    const hospitals = hr.elements
      .map((e) => ({ name: e.tags?.name ?? 'Hospital', lon: round(e.lon ?? e.center?.lon), lat: round(e.lat ?? e.center?.lat), emergency: e.tags?.emergency ?? null }))
      .filter((h) => h.lon != null && h.emergency !== 'no' && !/psychiatr|mental|residential|long.term|care home|lodge|village|manor/i.test(h.name));
    const named = (re, fallback) => { const h = hospitals.find((x) => re.test(x.name)); return h ? { name: h.name, lon: h.lon, lat: h.lat } : fallback; };
    const city = named(/kootenay boundary regional/i, DESTINATIONS.city);
    const kelowna = named(/kelowna general/i, DESTINATIONS.kelowna);
    const ycg = res.elements.find((e) => e.tags?.aeroway === 'aerodrome' && (e.tags.iata === 'YCG' || /west kootenay|castlegar/i.test(e.tags.name ?? '')));
    const airport = ycg ? { name: ycg.tags.name ?? DESTINATIONS.airport.name, lon: round(ycg.lon ?? ycg.center.lon), lat: round(ycg.lat ?? ycg.center.lat) } : DESTINATIONS.airport;

    const counts = pois.reduce((a, p) => ((a[p[2]] = (a[p[2]] ?? 0) + 1), a), {});
    log(`  ${pois.length} places (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}); ${trails.length} trails; ferries ${ferry.map((f) => f.name).join(', ')}; ${hospitals.length} hospitals in the care box`);
    await writeOut('osm', { source: `OpenStreetMap contributors via the Overpass API (${ODBL})`, pois, trails, ferry, hospitals, city, kelowna, airport });
  },

  // Trails & waterfalls: the footpath network, routes with elevation profiles, waterfalls and photos.
  async trails() {
    await buildTrails({ log, cached, writeOut, round, distKm, getRegion: getLakes, onRegion, kmToShore, PLACES, BBOX });
  },

  // Drive times from each place with the public OSRM router (one table request, then one
  // route request per place to its nearest hospital, for the road line). The router includes
  // the inland ferries where OpenStreetMap maps them as ferry routes.
  async drive() {
    const osm = await readOut('osm');
    if (!osm) throw new Error('run the osm stage first');
    const hospitals = osm.hospitals ?? [];
    const groceries = osm.pois.filter((p) => p[2] === 'grocery');
    if (!hospitals.length) throw new Error('no hospitals in osm.json');
    const dests = [
      ...hospitals.map((h) => ({ kind: 'er', name: h.name, lon: h.lon, lat: h.lat })),
      ...groceries.map((g) => ({ kind: 'grocery', name: g[3] ?? 'Grocery store', lon: g[0], lat: g[1] })),
      { kind: 'city', ...osm.city },
      { kind: 'airport', ...osm.airport },
      { kind: 'kelowna', ...osm.kelowna },
    ];
    const pts = [...PLACES.map((p) => [p.lon, p.lat]), ...dests.map((d) => [d.lon, d.lat])];
    const coords = pts.map((p) => p.join(',')).join(';');
    const src = PLACES.map((_, i) => i).join(';');
    const dst = dests.map((_, i) => PLACES.length + i).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=${src}&destinations=${dst}&annotations=duration,distance`;
    const tab = await cachedJSON('osrm/table.json', url, { timeout: 60_000 });
    if (tab.code !== 'Ok') throw new Error(`OSRM: ${tab.code}`);
    const out = {};
    for (const [i, p] of PLACES.entries()) {
      const trip = (j) => (tab.durations[i][j] == null ? null : { name: dests[j].name, min: Math.round(tab.durations[i][j] / 60), km: round(tab.distances[i][j] / 1000, 1), lon: dests[j].lon, lat: dests[j].lat });
      const best = (kind) => dests.map((d, j) => (d.kind === kind ? trip(j) : null)).filter(Boolean).sort((a, b) => a.min - b.min);
      out[p.key] = { er: best('er').slice(0, 4), grocery: best('grocery')[0] ?? null, city: best('city')[0] ?? null, airport: best('airport')[0] ?? null, kelowna: best('kelowna')[0] ?? null };
    }
    // road line to the nearest hospital, politely, one place at a time
    for (const p of PLACES) {
      const e = out[p.key].er[0];
      if (!e) continue;
      const r = await cachedJSON(`osrm/route-${p.key}.json`, `https://router.project-osrm.org/route/v1/driving/${p.lon},${p.lat};${e.lon},${e.lat}?overview=simplified&geometries=geojson`, { timeout: 60_000 }).catch(() => null);
      if (r?.routes?.[0]) e.line = r.routes[0].geometry.coordinates.map(([x, y]) => [round(x), round(y)]);
      await sleep(300);
    }
    log(`  ${PLACES.length} places × ${dests.length} destinations`);
    // only hospitals that are someone's nearest or second-nearest are drawn on the map
    const used = new Set(Object.values(out).flatMap((r) => r.er.slice(0, 2).map((e) => e.name)));
    await writeOut('drive', { source: 'Drive times: OSRM demo router (router.project-osrm.org) on OpenStreetMap roads and ferries', hospitals: hospitals.filter((h) => used.has(h.name)).map(({ name, lon, lat }) => ({ name, lon, lat })), places: out });
  },
};

function titleCase(s) {
  return String(s).toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bA\b$/, 'A').replace(/\(Aut\)/, '(AUT)');
}
function lengthKm(parts) {
  let km = 0;
  for (const p of parts) for (let i = 1; i < p.length; i++) km += distKm(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
  return km;
}

// ---------------------------------------------------------------------------------------------

const order = ['base', 'places', 'population', 'census', 'water', 'fires', 'climate', 'normals', 'quakes', 'osm', 'trails', 'drive'];

async function main() {
  const want = process.argv.slice(2);
  const stages = want.length ? order.filter((s) => want.includes(s)) : order;
  const unknown = want.filter((w) => !order.includes(w));
  if (unknown.length) console.warn(`unknown stage(s): ${unknown.join(', ')} — choose from ${order.join(', ')}`);
  const manifest = (await readOut('manifest')) ?? {};
  for (const s of stages) {
    const started = new Date().toISOString();
    console.log(`\n▸ ${s}`);
    try {
      await SOURCES[s]();
      manifest[s] = { ok: true, updated: started, lastAttempt: started };
    } catch (e) {
      console.error(`  ✗ ${s} failed: ${e.message}`);
      manifest[s] = { ...(manifest[s] ?? {}), ok: false, lastError: String(e.message).slice(0, 200), lastAttempt: started };
    }
  }
  await writeOut('manifest', manifest);
}

main();
