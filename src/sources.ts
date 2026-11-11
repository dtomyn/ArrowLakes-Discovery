// The sources view: the banded silt of the reservoir's drawdown banks, where the lake lays down a
// layer of sediment every year. Each data source is a core pushed down through the bank, each year
// one layer (oldest at the bottom), and a layer glows as strongly as that source's own record for the year. Sources that
// describe the present (a single moment) show as a bright cap at the top. Every number here is
// counted from the loaded data, not typed in.
import * as d3 from 'd3';
import { Data, fmt, keyToT } from './data';
import { esc } from './html';

type Bed = { v: number; label: string };
type Source = {
  id: string; key: string; layer: string | null; name: string; color: string; group: string;
  owner: string; title: string; url: string; endpoint: string; licence: string; gives: string;
  read: (d: Data) => { n: number; what: string } | null;
  beds: (d: Data) => Record<number, Bed>;
};

const NOW = new Date().getFullYear();
const SHORT: Record<string, string> = { water: 'Levels', fires: 'Fires', climate: 'Temp', normals: 'Weather', quakes: 'Quakes', population: 'People', census: 'Census', osm: 'OSM', trails: 'Trails', drive: 'Drives' };
const OGL = 'OGL – Canada';
const OGLBC = 'OGL – British Columbia';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const norm = (rows: Record<number, number>) => {
  const vals = Object.values(rows);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return (y: number) => (hi === lo ? 0.6 : 0.15 + 0.85 * ((rows[y] - lo) / (hi - lo)));
};
const cap = (label: string, y = NOW): Record<number, Bed> => ({ [y]: { v: 1, label } });

const SOURCES: Source[] = [
  {
    id: 'water', key: 'water', layer: 'water', name: 'Lake levels', color: '#4cc9f0', group: 'The lake & the forest',
    owner: 'Environment and Climate Change Canada', title: 'HYDAT national water data archive: monthly mean levels', url: 'https://api.weather.gc.ca/collections/hydrometric-monthly-mean',
    endpoint: 'api.weather.gc.ca/collections/hydrometric-monthly-mean · 08NE104, 08NE102, 08NE045, 08NE046', licence: OGL,
    gives: 'Monthly water levels on the Arrow Lakes: the reservoir since 1969 at Nakusp and Fauquier, and the natural lakes before the dam.',
    read: (d) => d.water && { n: sum(d.water.stations.map((s) => Object.keys(s.months).length)), what: `monthly levels from ${d.water.stations.length} gauges` },
    beds: (d) => {
      const s = d.water?.stations.find((x) => x.lake === 'reservoir');
      if (!s) return {};
      const yr: Record<number, number[]> = {};
      for (const [k, v] of Object.entries(s.months)) (yr[Math.floor(keyToT(k))] ??= []).push(v);
      const m: Record<number, number> = Object.fromEntries(Object.entries(yr).map(([y, xs]) => [y, d3.mean(xs)!]));
      const f = norm(m);
      return Object.fromEntries(Object.keys(m).map((y) => [y, { v: f(+y), label: `${s.name}: ${m[+y].toFixed(2)} m average` }]));
    },
  },
  {
    id: 'fires', key: 'fires', layer: 'fires', name: 'Wildfires', color: '#ff7a45', group: 'The lake & the forest',
    owner: 'BC Wildfire Service', title: 'Fire Perimeters – Historical and Current (BC Data Catalogue)', url: 'https://catalogue.data.gov.bc.ca/dataset/fire-perimeters-historical',
    endpoint: 'openmaps.gov.bc.ca/geo/pub/wfs · PROT_HISTORICAL_FIRE_POLYS_SP, PROT_CURRENT_FIRE_POLYS_SP', licence: OGLBC,
    gives: 'The outline, size, start date and cause of every mapped wildfire in the valley since 1919.',
    read: (d) => d.fires && { n: d.fires.rows.length, what: `fires, ${fmt.int(sum(d.fires.rows.map((f) => f.ha)))} ha in all` },
    beds: (d) => {
      const ha: Record<number, number> = {};
      for (const f of d.fires?.rows ?? []) { const y = Math.floor(f.t); ha[y] = (ha[y] ?? 0) + f.ha; }
      const hi = Math.max(1, ...Object.values(ha));
      return Object.fromEntries(Object.entries(ha).map(([y, v]) => [y, { v: 0.12 + 0.88 * Math.sqrt(v / hi), label: `${fmt.int(v)} ha burned` }]));
    },
  },
  {
    id: 'climate', key: 'climate', layer: 'climate', name: 'Temperature', color: '#f25f5c', group: 'Weather & ground',
    owner: 'Environment and Climate Change Canada', title: 'Adjusted and Homogenized Canadian Climate Data (AHCCD)', url: 'https://api.weather.gc.ca/collections/ahccd-annual',
    endpoint: 'api.weather.gc.ca/collections/ahccd-annual', licence: OGL,
    gives: 'Annual mean temperatures, corrected for station moves and instrument changes.',
    read: (d) => d.climate && { n: sum(d.climate.stations.map((s) => Object.keys(s.temp).length)), what: `station-years from ${d.climate.stations.length} stations` },
    beds: (d) => {
      const out: Record<number, Bed> = {};
      const ys = new Set((d.climate?.stations ?? []).flatMap((s) => Object.keys(s.temp).map(Number)));
      for (const y of ys) {
        const xs = d.climate!.stations.filter((s) => s.temp[y] != null).map((s) => s.temp[y] - s.baseline);
        const a = d3.mean(xs)!;
        out[y] = { v: Math.max(0.12, Math.min(1, 0.5 + a / 3)), label: `${fmt.signed(a, 2)} °C vs 1961–90 (${xs.length} stations)` };
      }
      return out;
    },
  },
  {
    id: 'normals', key: 'normals', layer: 'climate', name: 'Valley weather', color: '#ffb3a8', group: 'Weather & ground',
    owner: 'Environment and Climate Change Canada', title: 'Monthly climate summaries, Castlegar A and Nakusp CS', url: 'https://api.weather.gc.ca/collections/climate-monthly',
    endpoint: 'api.weather.gc.ca/collections/climate-monthly · 1141455, 1145297', licence: OGL,
    gives: 'Thirty years of monthly temperature, rain and snow at Castlegar airport and Nakusp, averaged here.',
    read: (d) => d.normals && { n: d.normals.stations.length * 360, what: `station-months averaged over ${d.normals.stations[0].period}` },
    beds: (d) => {
      const p = d.normals?.stations[0]?.period;
      if (!p) return {};
      const [a, b] = p.split('–').map(Number);
      return Object.fromEntries(d3.range(a, b + 1).map((y) => [y, { v: 0.5, label: `inside the ${p} averaging period` }]));
    },
  },
  {
    id: 'quakes', key: 'quakes', layer: 'quakes', name: 'Earthquakes', color: '#f9d65c', group: 'Weather & ground',
    owner: 'Natural Resources Canada', title: 'National Earthquake Database', url: 'https://earthquakescanada.nrcan.gc.ca/stndon/NEDB-BNDS/bulletin-en.php',
    endpoint: 'earthquakescanada.nrcan.gc.ca/fdsnws/event/1/query', licence: OGL,
    gives: 'Earthquakes and blasts across BC’s southern interior and the Rockies since 1985.',
    read: (d) => d.quakes && { n: d.quakes.rows.length, what: `events, ${d.quakes.rows.filter((q) => q[6] === 0).length} of them natural` },
    beds: (d) => {
      const n: Record<number, number> = {};
      for (const q of d.quakes?.rows ?? []) { const y = Math.floor(q[4]); n[y] = (n[y] ?? 0) + 1; }
      const f = norm(n);
      return Object.fromEntries(Object.keys(n).map((y) => [y, { v: f(+y), label: `${n[+y]} events` }]));
    },
  },
  {
    id: 'population', key: 'population', layer: 'population', name: 'Population', color: '#3ecf8e', group: 'People & homes',
    owner: 'Statistics Canada', title: 'Table 17-10-0155-01: population estimates by census subdivision', url: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1710015501',
    endpoint: 'www150.statcan.gc.ca/n1/tbl/csv/17100155-eng.zip', licence: OGL,
    gives: 'Population on July 1 each year for each city, village and regional-district area.',
    read: (d) => d.population && { n: sum(Object.values(d.population.csds).map((s) => Object.keys(s).length)), what: `annual estimates for ${Object.keys(d.population.csds).length} areas` },
    beds: (d) => {
      const tot: Record<number, number> = {};
      for (const s of Object.values(d.population?.csds ?? {})) for (const [y, v] of Object.entries(s)) tot[+y] = (tot[+y] ?? 0) + v;
      const f = norm(tot);
      return Object.fromEntries(Object.keys(tot).map((y) => [y, { v: f(+y), label: `${fmt.int(tot[+y])} residents` }]));
    },
  },
  {
    id: 'census', key: 'census', layer: 'homes', name: '2021 Census', color: '#b388ff', group: 'People & homes',
    owner: 'Statistics Canada', title: 'Census Profile, 2021 Census of Population', url: 'https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm',
    endpoint: 'api.statcan.gc.ca/census-recensement/profile/sdmx · DF_CSD', licence: OGL,
    gives: 'Home values, incomes, age and households for each census subdivision.',
    read: (d) => d.census && { n: Object.values(d.census.csds).reduce((a, c) => a + Object.values(c).filter((v) => v != null).length, 0), what: `figures for ${Object.keys(d.census.csds).length} areas` },
    beds: (d) => (d.census ? cap('Census day, May 2021', 2021) : {}),
  },
  {
    id: 'osm', key: 'osm', layer: 'life', name: 'OpenStreetMap', color: '#ffd166', group: 'Getting around',
    owner: 'OpenStreetMap contributors', title: 'Overpass API: amenities, trails, ferries and hospitals', url: 'https://www.openstreetmap.org/relation/2198542',
    endpoint: 'overpass-api.de/api/interpreter', licence: 'ODbL 1.0',
    gives: 'Beaches, marinas, hot springs, trails, ferries, shops, schools and hospitals, mapped by volunteers.',
    read: (d) => d.osm && { n: d.osm.pois.length + d.osm.trails.length, what: `${d.osm.pois.length} places and ${d.osm.trails.length} trails` },
    beds: (d) => (d.osm ? cap('mapped today') : {}),
  },
  {
    id: 'trails', key: 'trails', layer: 'hikes', name: 'Trails & waterfalls', color: '#34d399', group: 'Getting around',
    owner: 'OpenStreetMap, Wikimedia Commons, Wikidata', title: 'Footpaths, hiking routes and waterfalls, with photos and terrain profiles', url: 'https://www.openstreetmap.org/relation/2198542',
    endpoint: 'overpass-api.de · commons.wikimedia.org/w/api.php · query.wikidata.org · Mapzen terrain tiles', licence: 'ODbL 1.0; photos under their own Commons licences; Wikidata CC0',
    gives: 'Every mapped footpath, the guide’s routes with elevation profiles for the 3D flights, waterfalls, and photos of the guide stops.',
    read: (d) => d.trails && { n: d.trails.routes.length + d.trails.falls.length + d.trails.netPaths, what: `${d.trails.netPaths} paths (${d.trails.netKm} km), ${d.trails.routes.length} routes, ${d.trails.falls.length} waterfalls` },
    beds: (d) => (d.trails ? cap('mapped today') : {}),
  },
  {
    id: 'drive', key: 'drive', layer: 'health', name: 'Drive times', color: '#6c8cff', group: 'Getting around',
    owner: 'Project OSRM', title: 'OSRM demo routing server on OpenStreetMap roads', url: 'https://project-osrm.org/',
    endpoint: 'router.project-osrm.org/table/v1/driving', licence: 'ODbL 1.0 (road data)',
    gives: 'Drive minutes from each community to hospitals, groceries, the airport, Trail’s regional hospital and Kelowna.',
    read: (d) => d.drive && { n: sum(Object.values(d.drive.places).map((p) => p.er.length + 4)), what: `routes from ${Object.keys(d.drive.places).length} communities` },
    beds: (d) => (d.drive ? cap('routed today') : {}),
  },
];

const BASE = [
  { name: 'Lake outline', key: 'base', owner: 'OpenStreetMap contributors', title: 'Upper and Lower Arrow Lake (relations 2198542, 2198541) via Nominatim', url: 'https://www.openstreetmap.org/relation/2198542', licence: 'ODbL 1.0', gives: 'The full-pool shoreline everything is drawn against.' },
  { name: 'Basemap', owner: 'CARTO · OpenStreetMap', title: 'CARTO Dark Matter vector tiles', url: 'https://carto.com/basemaps/', licence: 'CC BY 4.0 / ODbL', gives: 'Roads, lakes and labels under the data.' },
  { name: 'Terrain', owner: 'Mapzen · AWS Open Data', title: 'Terrain Tiles (Terrarium)', url: 'https://registry.opendata.aws/terrain-tiles/', licence: 'Various open licences', gives: 'Shaded relief: the Monashee and Selkirk mountains either side of the lakes.' },
];

const DERIVED: [string, string][] = [
  ['The lake surface', 'on the map uses the Nakusp reservoir gauge, gaps filled from Fauquier; the pre-dam gauges are compared by their yearly swing, because their datums differ.'],
  ['Regional temperature', 'is the average of every adjusted station’s difference from its own 1961–1990 mean.'],
  ['“What it feels like”', 'averages the monthly records at Castlegar airport and Nakusp over each station’s latest 30 years; these are not official climate normals.'],
  ['Fire totals', 'add up the mapped area of each fire perimeter by its start year.'],
  ['Beach, trail and service counts', 'count mapped OpenStreetMap features within 10–15 km of each community centre.'],
  ['Distance to the shore', 'is measured to the Arrow Lakes’ full-pool shoreline, not other lakes or rivers.'],
  ['Place Finder scores', 'are this atlas’s own blend of the numbers above, weighted by you.'],
];

// ---------------------------------------------------------------------------------------------

let root: HTMLElement | null = null;
export const sourcesOpen = () => !!root;

export function closeSources() {
  if (!root) return;
  const el = root;
  root = null;
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 260);
  if (location.hash === '#sources') history.replaceState(null, '', location.pathname + location.search);
}

export function openSources(data: Data, opts: { onShow: (layerId: string) => void }) {
  if (root) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const beds = SOURCES.map((s) => s.beds(data));
  const reads = SOURCES.map((s) => s.read(data));
  const live = beds.map((b) => Object.keys(b).length > 0);
  const records = sum(reads.map((r) => r?.n ?? 0));
  const allYears = beds.flatMap((b) => Object.keys(b).map(Number));
  const Y0 = Math.min(...allYears, NOW - 50);
  const owners = new Set([...SOURCES, ...BASE].map((s) => s.owner));
  const status = (key?: string) => {
    if (!key) return '<span class="src-st">loaded live by the map</span>';
    const m = data.manifest[key];
    if (!m?.ok) return `<span class="src-st bad">not available${m?.lastError ? ` · ${esc(m.lastError)}` : ''}</span>`;
    return `<span class="src-st ok">refreshed ${m.updated ? new Date(m.updated).toLocaleDateString('en-CA') : ''}</span>`;
  };
  const groups = [...new Set(SOURCES.map((s) => s.group))];

  root = document.createElement('div');
  root.className = 'sources';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'src-title');
  root.innerHTML = `
    <button class="close-x" aria-label="Close sources">×</button>
    <div class="src-stage">
      <div class="src-intro">
        <div class="kicker">Data &amp; sources</div>
        <h2 id="src-title">Read the lakebed</h2>
        <p>When the reservoir is drawn down, its banks show the silt the lake lays down, layer upon layer. This bank reads the atlas the same way: each core is one source, each layer one year from ${Y0} at the bottom to ${NOW} at the top, and a layer glows as strongly as that source’s record for the year. Hover a layer to read it; click to open its source.</p>
        <dl class="src-stats">
          <div><dd data-count="${SOURCES.length + BASE.length}">0</dd><dt>sources</dt></div>
          <div><dd data-count="${owners.size}">0</dd><dt>publishers</dt></div>
          <div><dd data-count="${records}">0</dd><dt>records read</dt></div>
          <div><dd data-count="${NOW - Y0 + 1}">0</dd><dt>years of silt</dt></div>
        </dl>
      </div>
      <div class="src-round">
        <canvas aria-label="Sediment chart: one core per data source, one layer per year from ${Y0} to ${NOW}"></canvas>
        <div class="src-year" aria-hidden="true"></div>
        <div class="src-tip" hidden></div>
      </div>
    </div>
    <div class="src-list">
      ${groups.map((g) => `<h3>${g}</h3>${SOURCES.map((s, i) => s.group !== g ? '' : `
        <article class="src-card${live[i] ? '' : ' off'}" data-i="${i}" tabindex="0" style="--c:${s.color}">
          <header><span class="src-dot"></span><b>${s.name}</b>${status(s.key)}</header>
          <div class="src-owner">${esc(s.owner)}</div>
          <a class="src-title" href="${s.url}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>
          <p>${s.gives}</p>
          ${reads[i] ? `<div class="src-read"><b data-count="${reads[i]!.n}">0</b> records · ${esc(reads[i]!.what)}</div>` : ''}
          <code>${esc(s.endpoint)}</code>
          <footer><span class="src-lic">${esc(s.licence)}</span>${live[i] && s.layer ? `<button class="src-go" data-id="${s.layer}">See it on the map →</button>` : ''}</footer>
        </article>`).join('')}`).join('')}
      <h3>The ground: what everything sits on</h3>
      ${BASE.map((b) => `
        <article class="src-card bark">
          <header><span class="src-dot"></span><b>${b.name}</b>${status(b.key)}</header>
          <div class="src-owner">${esc(b.owner)}</div>
          <a class="src-title" href="${b.url}" target="_blank" rel="noopener">${esc(b.title)} ↗</a>
          <p>${b.gives}</p>
          <footer><span class="src-lic">${esc(b.licence)}</span></footer>
        </article>`).join('')}
      <h3>What this atlas worked out itself</h3>
      <ul class="src-derived">${DERIVED.map(([k, v]) => `<li><b>${k}</b> ${v}</li>`).join('')}</ul>
      <p class="note">Contains information licensed under the Open Government Licence – Canada. Refresh everything with <code>npm run data</code>; a source that fails keeps its last good copy and shows it above. This is a personal exploration tool, not real-estate, legal, medical or hazard advice.</p>
      <button class="src-cite">Copy a citation</button>
    </div>`;
  document.body.appendChild(root);
  if (location.hash !== '#sources') history.replaceState(null, '', '#sources');

  const el = root;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const canvas = $<HTMLCanvasElement>('canvas'), g = canvas.getContext('2d')!;
  const tip = $('.src-tip'), yearEl = $('.src-year');
  const cards = [...el.querySelectorAll<HTMLElement>('.src-card[data-i]')];

  // geometry: cores side by side, years stacked from the bottom
  let W = 0, H = 0, x0 = 0, colW = 0, gap = 0, yTop = 0, yBot = 0, dpr = 1;
  const N = SOURCES.length;
  const bedY = (y: number) => yBot - ((y - Y0) / (NOW - Y0 + 1)) * (yBot - yTop);
  const bedH = () => (yBot - yTop) / (NOW - Y0 + 1);
  // a fixed wobble per layer so the bands look like silt, not a spreadsheet
  const wob = d3.range(NOW - Y0 + 2).map((i) => Math.sin(i * 1.7) * 0.4 + Math.sin(i * 0.31) * 1.2);

  function resize() {
    const box = (canvas.parentElement as HTMLElement).getBoundingClientRect();
    W = Math.max(280, box.width - 10); H = Math.max(280, Math.min(box.height - 10, 760));
    dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    gap = Math.max(6, W * 0.012);
    colW = Math.min(64, (W * 0.86 - gap * (N - 1)) / N);
    x0 = Math.max(58, (W - (colW * N + gap * (N - 1))) / 2);
    colW = Math.min(colW, (W - x0 - 16 - gap * (N - 1)) / N);
    yTop = 34; yBot = H - 26;
  }

  let hover: { i: number; y: number } | null = null;
  function draw(upTo: number) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // the bank behind the cores
    const rock = g.createLinearGradient(0, yTop, 0, yBot);
    rock.addColorStop(0, '#2a2a24'); rock.addColorStop(1, '#12130f');
    g.fillStyle = rock;
    g.beginPath();
    g.moveTo(x0 - 24, yBot + 6);
    for (let k = 0; k <= 24; k++) g.lineTo(x0 - 24 + (k / 24) * (W - 2 * x0 + 48), yTop - 10 + Math.sin(k * 1.3) * 5);
    g.lineTo(W - x0 + 24, yBot + 6);
    g.closePath();
    g.fill();
    const bh = bedH();
    for (let y = Y0; y <= NOW; y++) {
      const yy = bedY(y + 1);
      g.fillStyle = (y - Y0) % 2 ? 'rgba(255,240,215,.025)' : 'rgba(0,0,0,.08)';
      g.fillRect(x0 - 24, yy, W - 2 * x0 + 48, bh);
    }
    SOURCES.forEach((s, i) => {
      const cx = x0 + i * (colW + gap);
      g.fillStyle = 'rgba(255,255,255,.035)';
      g.fillRect(cx, yTop, colW, yBot - yTop);
      const c = d3.rgb(s.color);
      for (const [ys, b] of Object.entries(beds[i])) {
        const y = +ys;
        if (y > upTo || y < Y0) continue;
        const top = bedY(y + 1) + wob[y - Y0];
        const on = hover && hover.i === i && hover.y === y;
        g.fillStyle = `rgba(${c.r},${c.g},${c.b},${on ? 1 : 0.12 + b.v * 0.8})`;
        g.fillRect(cx, top, colW, Math.max(1.2, bh - 0.4));
      }
      g.save();
      g.translate(cx + colW / 2, yTop - 8);
      g.fillStyle = live[i] ? s.color : '#5d6b84';
      g.font = '600 10.5px Inter, sans-serif';
      g.textAlign = 'center';
      g.fillText(SHORT[s.id] ?? s.name, 0, 0);
      g.restore();
    });
    g.fillStyle = '#7d8aa3';
    g.font = '500 10.5px JetBrains Mono, monospace';
    g.textAlign = 'right';
    for (let y = Math.ceil(Y0 / 20) * 20; y <= NOW; y += 20) g.fillText(String(y), x0 - 30, bedY(y) + 3);
  }

  function pick(ev: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const i = Math.floor((x - x0) / (colW + gap));
    if (i < 0 || i >= N || x - x0 - i * (colW + gap) > colW) return null;
    const yr = Math.floor(Y0 + ((yBot - y) / (yBot - yTop)) * (NOW - Y0 + 1));
    return yr >= Y0 && yr <= NOW ? { i, y: yr, x, py: y } : null;
  }
  canvas.addEventListener('pointermove', (ev) => {
    const h = pick(ev);
    hover = h ? { i: h.i, y: h.y } : null;
    cards.forEach((c, k) => c.classList.toggle('on', !!h && k === h.i));
    if (!h) { tip.hidden = true; draw(NOW); return; }
    const b = beds[h.i][h.y];
    tip.innerHTML = `<b>${SOURCES[h.i].name} · ${h.y}</b><br>${b ? esc(b.label) : '<span class="dim">no record this year</span>'}`;
    tip.hidden = false;
    tip.style.transform = `translate(${Math.min(h.x + 14, W - 240)}px, ${h.py + 14}px)`;
    draw(NOW);
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; cards.forEach((c) => c.classList.remove('on')); draw(NOW); });
  canvas.addEventListener('click', (ev) => {
    const h = pick(ev as PointerEvent);
    if (h) cards[h.i].scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  });

  el.querySelector('.close-x')!.addEventListener('click', closeSources);
  el.querySelectorAll<HTMLButtonElement>('.src-go').forEach((b) => b.addEventListener('click', () => { closeSources(); opts.onShow(b.dataset.id!); }));
  el.querySelector('.src-cite')!.addEventListener('click', (e) => {
    const txt = `Arrow Lakes Atlas: the Arrow Lakes valley in open data (${NOW}). Sources: ${SOURCES.map((s) => s.owner).filter((v, i, a) => a.indexOf(v) === i).join('; ')}.`;
    navigator.clipboard?.writeText(txt).then(() => ((e.target as HTMLElement).textContent = 'Copied ✓')).catch(() => {});
  });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeSources(); window.removeEventListener('keydown', onKey); } };
  window.addEventListener('keydown', onKey);

  resize();
  window.addEventListener('resize', () => { if (root === el) { resize(); draw(NOW); } });
  const counters = [...el.querySelectorAll<HTMLElement>('[data-count]')];
  const count = (p: number) => counters.forEach((k) => (k.textContent = fmt.int(+k.dataset.count! * p)));
  if (calm) { draw(NOW); count(1); yearEl.classList.add('done'); return; }
  const start = performance.now(), DUR = 2600;
  const step = (now: number) => {
    if (root !== el) return;
    const p = Math.min(1, (now - start) / DUR), e = d3.easeCubicOut(p);
    const upTo = Math.floor(Y0 + (NOW - Y0) * e);
    draw(upTo);
    count(e);
    yearEl.textContent = String(upTo);
    if (p < 1) requestAnimationFrame(step); else yearEl.classList.add('done');
  };
  requestAnimationFrame(step);
}
