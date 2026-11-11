// Trails & waterfalls: every mapped footpath in the Arrow Lakes valley, the hiking routes with elevation
// profiles worked out from terrain tiles, every mapped waterfall (with Wikidata photos and heights
// where they exist) and photos for the hand-picked guide stops in src/hikes.ts. Run as the `trails`
// stage of fetch-data.mjs. Ported from Manitoulin Atlas (and Island Atlas before it); like Manitoulin the
// valley has few route relations: the guide's hikes become routes of their own, built from the named OSM ways
// each guide entry matches, and any other named trail long enough to walk becomes a route too.
//
// Sources: OpenStreetMap via Overpass (ODbL): route=hiking/foot relations, footpaths
// (highway=path/footway/bridleway and named trail tracks), waterway=waterfall. Wikidata (CC0) for
// waterfall photos and heights; Wikimedia Commons for geotagged photos; Mapzen / AWS terrain tiles
// for elevations.
//
// Writes trails.json (routes, waterfalls, guide extras, per-place summaries, a trail-density grid)
// and trails-net.json (the whole path network, delta-encoded; loaded only when the layer is opened).

import { unzlibSync } from 'fflate';
import { GUIDE } from '../src/hikes.ts';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
// Wikimedia's API policy asks for a User-Agent with a way to reach the operator; without one it answers 429
const UA = { 'User-Agent': 'ArrowLakesAtlas/0.1 (https://github.com/dtomyn; open-data atlas build script)', Accept: 'application/json' };
const DEM_ZOOM = 12;
const LAT0 = 50.1;
const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180), MY = 110540; // metres per degree, locally
const Q = 1e4; // network coordinates in 1e-4 degree units
const GRID = 0.01; // trail-density grid cell, degrees
const LEVEL_OF = { Easy: 1, Moderate: 2, 'Moderate to hard': 3 };
const ROADISH = /\b(road|rd|street|st|drive|dr|lane|line|avenue|ave|highway|hwy|sideroad|crescent|court|boulevard)\b\.?$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function buildTrails(h) {
  const { log, cached, writeOut, round, distKm, getRegion, onRegion, PLACES, BBOX } = h;
  await getRegion();
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  // the valley: near the lakeshore or a community (see onRegion in fetch-data.mjs)
  const onIsl = onRegion;

  const fetchBuf = async (url, opts = {}) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(opts.timeout ?? 240_000) });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, wait: +(res.headers.get('retry-after') ?? 0) });
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        if (attempt >= (opts.retries ?? 4)) throw new Error(`${e.message} for ${url.slice(0, 120)}`);
        await sleep(e.status === 429 ? Math.max(e.wait * 1000, 15000 * attempt) : 3000 * attempt);
      }
    }
  };

  async function overpass(name, query) {
    return JSON.parse((await cached(`trails/osm-${name}.json`, async () => {
      let last;
      for (let r = 0; r < 3; r++)
        for (const url of OVERPASS) {
          try {
            const buf = r % 2 ? await fetchBuf(`${url}?data=${encodeURIComponent(query)}`, { retries: 1, timeout: 300_000 }) : await fetchBuf(url, { method: 'POST', body: new URLSearchParams({ data: query }), retries: 1, timeout: 300_000 });
            let j;
            try { j = JSON.parse(buf.toString('utf8')); } catch { throw new Error('busy (not JSON)'); }
            if (!Array.isArray(j.elements) || /runtime error|timed out|out of memory/i.test(j.remark ?? '')) throw new Error(`busy (${j.remark ?? 'no elements'})`);
            return buf;
          } catch (e) { last = e; log(`  overpass ${name}: ${e.message}, trying again`); await sleep(6000); }
        }
      throw last;
    })).toString('utf8'));
  }

  // ---------------------------------------------------------------------------------------------
  // 1. downloads

  log('  overpass: hiking routes');
  const osmRoutes = await overpass('routes', `[out:json][timeout:200];relation["route"~"^(hiking|foot)$"](${bbox});out geom;`);
  log('  overpass: path network');
  const osmNet = await overpass('network', `[out:json][timeout:300];(way["highway"~"^(path|footway|bridleway)$"]["footway"!~"^(sidewalk|crossing|access_aisle)$"]["access"!~"^(private|no)$"](${bbox});way["highway"="track"]["name"~"trail|loop|path|walk|lookout",i](${bbox}););out geom qt;`);
  log('  overpass: waterfalls');
  const osmFalls = await overpass('falls', `[out:json][timeout:120];nwr["waterway"="waterfall"](${bbox});out center;`);
  log(`  ${osmRoutes.elements.length} routes, ${osmNet.elements.length} paths, ${osmFalls.elements.length} waterfalls in the box`);

  const toM = ([lon, lat]) => [lon * MX, lat * MY];
  const fromM = ([x, y]) => [x / MX, y / MY];
  const lenM = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot((pts[i][0] - pts[i - 1][0]) * MX, (pts[i][1] - pts[i - 1][1]) * MY); return s; };
  const simplifyLL = (pts, tol) => dpLine(pts.map(toM), tol).map(fromM);
  const near = (a, b, m = 40) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY) < m;

  // ---------------------------------------------------------------------------------------------
  // 2. the path network (clipped, simplified, delta-encoded)

  const UNPAVED = /^(unpaved|dirt|ground|earth|grass|gravel|fine_gravel|compacted|mud|sand|rock|wood|woodchips|pebblestone)$/;
  const SAC = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3, alpine_hiking: 3, demanding_alpine_hiking: 3, difficult_alpine_hiking: 3 };
  const names = [];
  const nameIdx = new Map();
  const ways = [];
  const keptWays = []; // { id, name, pts } for named-trail routes
  const segs = []; // [lon, lat, metres] midpoints, for the grid and place sums
  for (const w of osmNet.elements) {
    if (w.type !== 'way' || !w.geometry?.length) continue;
    const t = w.tags ?? {};
    // footways in town are mostly sidewalks and plazas; keep them only when they read as trails
    if (t.highway === 'footway' && !(UNPAVED.test(t.surface ?? '') || /trail|path|loop|walk|lookout|boardwalk/i.test(t.name ?? ''))) continue;
    const pts = w.geometry.filter(Boolean).map((g) => [g.lon, g.lat]);
    if (pts.length < 2) continue;
    const mid = pts[pts.length >> 1];
    if (!onIsl(mid[0], mid[1])) continue;
    const m = lenM(pts);
    if (m < 15) continue;
    const s = pts.length > 2 ? simplifyLL(pts, 6) : pts;
    let ni = -1;
    if (t.name) { ni = nameIdx.get(t.name) ?? -1; if (ni < 0) { ni = names.length; names.push(t.name); nameIdx.set(t.name, ni); } }
    const enc = [ni, SAC[t.sac_scale] ?? 0];
    let px = 0, py = 0;
    for (const [lon, lat] of s) {
      const x = Math.round((lon - BBOX.west) * Q), y = Math.round((lat - BBOX.south) * Q);
      enc.push(x - px, y - py);
      px = x; py = y;
    }
    ways.push(enc);
    if (t.name && !ROADISH.test(t.name) && !/snowmobile|snowshoe|cross.country|\bski\b/i.test(t.name)) keptWays.push({ id: w.id, name: t.name, pts, sac: SAC[t.sac_scale] ?? 0 });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      segs.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot((b[0] - a[0]) * MX, (b[1] - a[1]) * MY)]);
    }
  }
  const netKm = segs.reduce((s, x) => s + x[2], 0) / 1000;
  log(`  network: ${ways.length} paths, ${Math.round(netKm)} km in the valley`);

  const gnx = Math.ceil((BBOX.east - BBOX.west) / GRID);
  const dens = new Map();
  for (const [lon, lat, m] of segs) {
    const k = Math.floor((lat - BBOX.south) / GRID) * gnx + Math.floor((lon - BBOX.west) / GRID);
    dens.set(k, (dens.get(k) ?? 0) + m);
  }

  // ---------------------------------------------------------------------------------------------
  // 3. elevation from terrain tiles (bilinear)

  const tiles = new Map();
  const tileXY = (lon, lat) => {
    const n = 2 ** DEM_ZOOM, r = (lat * Math.PI) / 180;
    return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
  };
  async function loadTiles(points) {
    const want = new Set();
    for (const [lon, lat] of points) { const [tx, ty] = tileXY(lon, lat); want.add(`${Math.floor(tx)}/${Math.floor(ty)}`); }
    const missing = [...want].filter((k) => !tiles.has(k));
    if (missing.length) log(`  terrain: ${missing.length} tiles at z${DEM_ZOOM}`);
    for (let i = 0; i < missing.length; i += 6)
      await Promise.all(missing.slice(i, i + 6).map(async (k) => {
        const buf = await cached(`trails/dem/${DEM_ZOOM}-${k.replace('/', '-')}.png`, () => fetchBuf(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_ZOOM}/${k}.png`, { headers: { Accept: 'image/png' } }));
        tiles.set(k, decodeTerrarium(buf));
      }));
  }
  const pxAt = (tx, ty) => {
    const t = tiles.get(`${Math.floor(tx)}/${Math.floor(ty)}`);
    if (!t) return null;
    return t[Math.min(255, Math.floor((ty % 1) * 256)) * 256 + Math.min(255, Math.floor((tx % 1) * 256))];
  };
  const elevAt = (lon, lat) => {
    const [tx, ty] = tileXY(lon, lat);
    const fx = tx * 256 - 0.5, fy = ty * 256 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const g = (x, y) => pxAt(x / 256 + 1e-9, y / 256 + 1e-9);
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    if (a == null || b == null || c == null || d == null) return g(Math.round(fx), Math.round(fy));
    return a * (1 - ax) * (1 - ay) + b * ax * (1 - ay) + c * (1 - ax) * ay + d * ax * ay;
  };

  // ---------------------------------------------------------------------------------------------
  // 4. routes: stitch pieces into chains, then into one ordered line for the profile and the flight

  function stitch(lines) {
    const chains = [];
    const left = lines.map((l) => l.slice());
    while (left.length) {
      let c = left.pop();
      for (let grew = true; grew; ) {
        grew = false;
        for (let i = 0; i < left.length; i++) {
          const l = left[i];
          const s = c[0], e = c[c.length - 1], ls = l[0], le = l[l.length - 1];
          if (near(e, ls)) c = c.concat(l.slice(1));
          else if (near(e, le)) c = c.concat(l.slice(0, -1).reverse());
          else if (near(s, le)) c = l.concat(c.slice(1));
          else if (near(s, ls)) c = l.slice().reverse().concat(c.slice(1));
          else continue;
          left.splice(i, 1); i--; grew = true;
        }
      }
      chains.push(c);
    }
    return chains.sort((a, b) => lenM(b) - lenM(a));
  }
  function order(chains) {
    const rest = chains.slice(1);
    let line = chains[0].slice();
    while (rest.length) {
      let best = -1, bd = Infinity, how = 0;
      for (let i = 0; i < rest.length; i++) {
        const c = rest[i], s = line[0], e = line[line.length - 1];
        const opts = [[e, c[0], 0], [e, c[c.length - 1], 1], [s, c[c.length - 1], 2], [s, c[0], 3]];
        for (const [p, q, k] of opts) { const d = Math.hypot((p[0] - q[0]) * MX, (p[1] - q[1]) * MY); if (d < bd) { bd = d; best = i; how = k; } }
      }
      const c = rest.splice(best, 1)[0];
      if (bd > 3000) continue; // far-flung pieces stay drawn but out of the line
      if (how === 0) line = line.concat(c);
      else if (how === 1) line = line.concat(c.slice().reverse());
      else if (how === 2) line = c.concat(line);
      else line = c.slice().reverse().concat(line);
    }
    return line;
  }

  // the candidates: relations, then the guide's hikes, then any other named trail
  const used = new Set(); // way ids already in a route
  const raw = [];
  const relWays = new Map(); // relation id -> [{id, pts}]
  for (const r of osmRoutes.elements) {
    if (r.type !== 'relation') continue;
    const list = [];
    for (const m of r.members ?? []) {
      if (m.type !== 'way' || !m.geometry?.length || /platform|stop/.test(m.role ?? '')) continue;
      const pts = m.geometry.filter(Boolean).map((g) => [g.lon, g.lat]);
      const mid = pts[pts.length >> 1];
      if (pts.length > 1 && onIsl(mid[0], mid[1])) list.push({ id: m.ref, pts });
    }
    if (list.length) relWays.set(r.id, { r, list });
  }

  // guide hikes: every named way (and route relation) that the guide entry's pattern matches, near it
  for (const g of GUIDE) {
    if (!g.trails) continue;
    const close = (pts) => distKm(g.lon, g.lat, pts[pts.length >> 1][0], pts[pts.length >> 1][1]) < 8;
    const pieces = keptWays.filter((w) => g.trails.test(w.name) && close(w.pts));
    for (const [, { r, list }] of relWays) if (g.trails.test(r.tags?.name ?? '') && close(list[0].pts)) pieces.push(...list.filter((w) => !pieces.some((p) => p.id === w.id)));
    if (!pieces.length) { log(`  guide ${g.id}: no mapped trail matches`); continue; }
    for (const p of pieces) used.add(p.id);
    raw.push({ key: `guide-${g.id}`, guide: g.id, name: g.name, lines: pieces.map((p) => p.pts), t: {}, level: LEVEL_OF[g.effort] ?? null, osm: null });
  }
  for (const [id, { r, list }] of relWays) {
    const t = r.tags ?? {};
    const name = t.name ?? t['name:en'] ?? t.ref;
    const left = list.filter((w) => !used.has(w.id));
    if (!name || left.length < list.length / 2) continue;
    for (const w of left) used.add(w.id);
    raw.push({ key: `rel-${id}`, guide: null, name, lines: left.map((w) => w.pts), t, level: null, osm: `relation/${id}` });
  }
  // other named trails, grouped by name and split where the same name sits in two places
  const byName = new Map();
  for (const w of keptWays) if (!used.has(w.id)) (byName.get(w.name) ?? byName.set(w.name, []).get(w.name)).push(w);
  for (const [name, list] of byName) {
    const groups = [];
    for (const w of list) {
      const g = groups.find((gr) => gr.some((x) => x.pts.some((p) => w.pts.some((q) => near(p, q, 1500)))));
      if (g) g.push(w); else groups.push([w]);
    }
    for (const gr of groups) {
      if (/^(walking path|path|trail|footpath|sidewalk)$/i.test(name.trim())) continue;
      const km = gr.reduce((s, w) => s + lenM(w.pts), 0) / 1000;
      if (km < 0.8) continue;
      raw.push({ key: `way-${gr[0].id}`, guide: null, name, lines: gr.map((w) => w.pts), t: {}, level: null, osm: `way/${gr[0].id}` });
    }
  }

  const stitched = raw.map((r) => { const chains = stitch(r.lines); return { r, chains, line: order(chains), km: r.lines.reduce((s, l) => s + lenM(l), 0) / 1000 }; });
  await loadTiles(stitched.flatMap((s) => s.line.filter((_, i) => i % 3 === 0)));
  // an out-and-back walk usually starts at its low end (the parking lot), not on the summit
  for (const s of stitched) {
    const a = s.line[0], b = s.line[s.line.length - 1];
    if (!near(a, b, 300) && (elevAt(a[0], a[1]) ?? 0) > (elevAt(b[0], b[1]) ?? 0) + 5) s.line = s.line.slice().reverse();
  }

  const routes = stitched.map(({ r, chains, line, km }) => {
    const lineKm = lenM(line) / 1000;
    const N = Math.max(40, Math.min(8000, Math.round(lineKm * 40)));
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot((line[i][0] - line[i - 1][0]) * MX, (line[i][1] - line[i - 1][1]) * MY));
    const total = cum[cum.length - 1];
    const prof = [];
    let k = 1;
    for (let i = 0; i < N; i++) {
      const d = (total * i) / (N - 1);
      while (k < cum.length - 1 && cum[k] < d) k++;
      const f = (d - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
      const a = line[k - 1], b = line[k];
      prof.push(Math.max(0, elevAt(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f) ?? 0));
    }
    // ascent on a lightly smoothed profile, ignoring wiggles under 3 m (the DEM is ~25 m pixels here)
    const sm = prof.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 1); j <= Math.min(prof.length - 1, i + 1); j++) { s += prof[j]; n++; } return s / n; });
    let up = 0, down = 0, ref = sm[0];
    for (const v of sm) { if (v - ref > 3) { up += v - ref; ref = v; } else if (ref - v > 3) { down += ref - v; ref = v; } }
    const M = Math.min(400, prof.length);
    const stored = Array.from({ length: M }, (_, i) => prof[Math.round((i * (prof.length - 1)) / (M - 1))]);
    const t = r.t;
    const loop = near(line[0], line[line.length - 1], 300);
    // effort: Naismith's rule, 4.5 km/h plus an hour per 600 m of climbing
    const hrs = km / 4.5 + up / 600;
    const sac = SAC[t.sac_scale] ?? 0;
    // mountain country: a real climb before a walk counts as hard
    const level = r.level ?? (sac >= 2 || hrs > 6 || up > 700 ? 3 : hrs > 2.5 || up > 250 ? 2 : 1);
    return {
      key: r.key,
      guide: r.guide,
      osm: r.osm,
      name: r.name,
      km: round(km, 1),
      up: Math.round(up),
      down: Math.round(down),
      hi: Math.round(Math.max(...prof)),
      lo: Math.round(Math.min(...prof)),
      hrs: round(hrs, 1),
      level,
      loop,
      net: t.network ?? null,
      op: t.operator ?? null,
      web: t.website ?? t.url ?? null,
      wiki: t.wikipedia ?? null,
      desc: t.description ?? t.note ?? null,
      parts: chains.map((c) => simplifyLL(c, 4).map(([lon, lat]) => [round(lon, 5), round(lat, 5)])),
      line: simplifyLL(line, 10).map(([lon, lat]) => [round(lon, 5), round(lat, 5)]),
      lineKm: round(lineKm, 1),
      prof: stored.map((v) => Math.round(v)),
    };
  }).sort((a, b) => (b.guide ? 1 : 0) - (a.guide ? 1 : 0) || b.km - a.km);
  log(`  routes: ${routes.length} (${routes.filter((r) => r.guide).length} from the guide), ${Math.round(routes.reduce((s, r) => s + r.km, 0))} km`);

  // ---------------------------------------------------------------------------------------------
  // 5. waterfalls, with Wikidata photos and heights where linked

  let falls = [];
  for (const f of osmFalls.elements) {
    const lon = f.lon ?? f.center?.lon, lat = f.lat ?? f.center?.lat;
    if (lon == null || !onIsl(lon, lat)) continue;
    const t = f.tags ?? {};
    const hNum = parseFloat(String(t.height ?? '').replace(',', '.'));
    falls.push({ osm: `${f.type}/${f.id}`, name: t.name ?? null, lon: round(lon, 5), lat: round(lat, 5), h: Number.isFinite(hNum) && hNum > 0 && hNum < 600 ? round(hNum, 1) : null, wd: t.wikidata ?? null, wiki: t.wikipedia ?? null, img: t.wikimedia_commons?.startsWith('File:') ? t.wikimedia_commons.slice(5) : t.image?.match(/File:(.+)$/)?.[1] ?? null });
  }
  falls = falls.filter((f, i) => !falls.some((g, j) => j < i && near([f.lon, f.lat], [g.lon, g.lat], 60) && (!f.name || f.name === g.name)));

  const qids = [...new Set(falls.map((f) => f.wd).filter((q) => /^Q\d+$/.test(q ?? '')))];
  const wd = {};
  for (let i = 0; i < qids.length; i += 45) {
    const ids = qids.slice(i, i + 45);
    try {
      const j = JSON.parse((await cached(`trails/wikidata-${ids[0]}-${ids.length}.json`, () => fetchBuf(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|sitelinks&ids=${ids.join('|')}`))).toString('utf8'));
      Object.assign(wd, j.entities ?? {});
    } catch (e) { log(`  wikidata: ${e.message}`); }
  }
  for (const f of falls) {
    const e = f.wd && wd[f.wd];
    if (!e) continue;
    const img = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (img && !f.img) f.img = img;
    const hc = e.claims?.P2048?.[0]?.mainsnak?.datavalue?.value;
    if (hc && !f.h) {
      let v = parseFloat(hc.amount);
      if (/Q3710$/.test(hc.unit)) v *= 0.3048;
      if (v > 0 && v < 600) f.h = round(v, 1);
    }
    if (!f.wiki && e.sitelinks?.enwiki) f.wiki = `en:${e.sitelinks.enwiki.title}`;
  }

  // Wikidata knows some falls OpenStreetMap doesn't link (and a few it hasn't mapped): match by place
  try {
    const sparql = `SELECT ?f ?fLabel ?coord ?img ?h ?hu ?enwiki WHERE { SERVICE wikibase:box { ?f wdt:P625 ?coord. bd:serviceParam wikibase:cornerSouthWest "Point(${BBOX.west} ${BBOX.south})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${BBOX.east} ${BBOX.north})"^^geo:wktLiteral. } ?f wdt:P31/wdt:P279* wd:Q34038. OPTIONAL { ?f wdt:P18 ?img. } OPTIONAL { ?f p:P2048/psv:P2048 [ wikibase:quantityAmount ?h; wikibase:quantityUnit ?hu ]. } OPTIONAL { ?enwiki schema:about ?f; schema:isPartOf <https://en.wikipedia.org/>. } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
    const j = JSON.parse((await cached('trails/wikidata-falls.json', () => fetchBuf(`https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}`, { headers: { Accept: 'application/sparql-results+json' } }))).toString('utf8'));
    let added = 0, matched = 0;
    for (const b of j.results?.bindings ?? []) {
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? '');
      if (!m) continue;
      const lon = +m[1], lat = +m[2], name = b.fLabel?.value;
      if (!onIsl(lon, lat) || !name || /^Q\d+$/.test(name) || /park/i.test(name)) continue;
      const img = b.img?.value ? decodeURIComponent(b.img.value.split('/').pop()).replace(/_/g, ' ') : null;
      let hv = b.h ? parseFloat(b.h.value) : null;
      if (hv && /Q3710$/.test(b.hu?.value ?? '')) hv *= 0.3048;
      const wiki = b.enwiki?.value ? `en:${decodeURIComponent(b.enwiki.value.split('/wiki/')[1]).replace(/_/g, ' ')}` : null;
      const hit = falls.find((f) => (f.name && f.name.toLowerCase() === name.toLowerCase() && near([f.lon, f.lat], [lon, lat], 3000)) || near([f.lon, f.lat], [lon, lat], 400));
      if (hit) { matched++; hit.img ??= img; hit.h ??= hv && hv > 0 && hv < 600 ? round(hv, 1) : null; hit.wiki ??= wiki; hit.name ??= name; }
      else { added++; falls.push({ osm: `wikidata/${b.f.value.split('/').pop()}`, name, lon: round(lon, 5), lat: round(lat, 5), h: hv && hv > 0 && hv < 600 ? round(hv, 1) : null, wd: null, wiki, img }); }
    }
    log(`  wikidata: ${matched} matched, ${added} added`);
  } catch (e) { log(`  wikidata falls: ${e.message}`); }

  // the guide names falls OpenStreetMap leaves unnamed
  for (const g of GUIDE.filter((x) => x.kind === 'falls')) {
    const f = falls.find((x) => near([x.lon, x.lat], [g.lon, g.lat], 600));
    if (f && !f.name) f.name = g.name;
  }

  // ---------------------------------------------------------------------------------------------
  // 6. photos from Wikimedia Commons: geotagged near a place and named for it

  async function commonsPhoto(lon, lat, radius, nameRe, key) {
    try {
      const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=geosearch&gsnamespace=6&gslimit=100&gsradius=${radius}&gscoord=${lat}|${lon}`;
      const j = JSON.parse((await cached(`trails/commons-${key}-${radius}.json`, async () => { await sleep(500); return fetchBuf(url, { retries: 6 }); })).toString('utf8'));
      const pick = (j.query?.geosearch ?? []).find((g) => {
        const t = g.title.replace(/^File:/, '');
        return /\.(jpe?g|png|webp)$/i.test(t) && nameRe.test(t) && !/\b(map|sign|logo|plaque|dedication|diagram|lily|plicata)\b/i.test(t);
      });
      return pick ? pick.title.replace(/^File:/, '') : null;
    } catch (e) { log(`  commons ${key}: ${e.message}`); return null; }
  }
  for (const f of falls.filter((x) => x.name && !x.img)) {
    const words = f.name.toLowerCase().replace(/\b(falls?|waterfalls?|cascades?|upper|lower|the)\b/g, '').trim().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter((w) => w.length > 2);
    if (!words.length) continue;
    const re = new RegExp(words.join('\\W+(?:\\w+\\W+)?') + '\\W+(?:(?:river|creek|upper|lower)\\W+)*(?:falls|waterfall|cascade)', 'i');
    f.img = await commonsPhoto(f.lon, f.lat, 800, re, `${f.lat}-${f.lon}`);
  }

  /** Fallback: a Commons text search for the stop's words plus "British Columbia"; the pick must name the valley or be geotagged in it. */
  async function commonsSearch(words, nameRe, key) {
    try {
      const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=40&srsearch=${encodeURIComponent(`${words} British Columbia filetype:bitmap`)}`;
      const j = JSON.parse((await cached(`trails/commons-search-${key}.json`, async () => { await sleep(500); return fetchBuf(url, { retries: 6 }); })).toString('utf8'));
      const cands = (j.query?.search ?? []).filter((g) => {
        const t = g.title.replace(/^File:/, '');
        return /\.(jpe?g|png|webp)$/i.test(t) && nameRe.test(t) && !/\b(map|sign|logo|plaque|dedication|diagram)\b/i.test(t);
      }).slice(0, 20);
      if (!cands.length) return null;
      // the title names a valley town or the lakes, or the photo is geotagged in the valley
      const cj = JSON.parse((await cached(`trails/commons-coords-${key}.json`, async () => { await sleep(500); return fetchBuf(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=coordinates&titles=${encodeURIComponent(cands.map((c) => c.title).join('|'))}`, { retries: 6 }); })).toString('utf8'));
      const at = new Map(Object.values(cj.query?.pages ?? {}).map((pg) => [pg.title, pg.coordinates?.[0]]));
      const pick = cands.find((c) => { const co = at.get(c.title); return /arrow\W*lakes?|nakusp|castlegar|revelstoke|kootenay/i.test(c.title) || (co && onIsl(co.lon, co.lat)); });
      return pick ? pick.title.replace(/^File:/, '') : null;
    } catch (e) { log(`  commons search ${key}: ${e.message}`); return null; }
  }

  // the guide stops: a photo, ground elevation, and the route or waterfall each one became
  await loadTiles([...GUIDE.map((g) => [g.lon, g.lat]), ...falls.map((f) => [f.lon, f.lat])]);
  const guide = {};
  for (const g of GUIDE) {
    const fi = g.kind === 'falls' ? falls.findIndex((x) => near([x.lon, x.lat], [g.lon, g.lat], 600)) : -1;
    let img = fi >= 0 ? falls[fi].img : null;
    if (!img && g.photo) img = await commonsPhoto(g.lon, g.lat, g.kind === 'hike' ? 4000 : 2500, g.photo, `guide-${g.id}`);
    if (!img && g.photo) img = await commonsSearch(g.name.replace(/\b(trails?|and|the)\b/gi, ' ').replace(/[’']/g, '').trim(), g.photo, `guide-${g.id}`);
    if (fi >= 0 && img) falls[fi].img ??= img;
    guide[g.id] = { route: routes.findIndex((r) => r.guide === g.id), fall: fi, img, elev: Math.round(Math.max(0, elevAt(g.lon, g.lat) ?? 0)) };
  }
  log(`  guide: ${Object.values(guide).filter((x) => x.img).length} of ${GUIDE.length} stops have a photo, ${Object.values(guide).filter((x) => x.route >= 0).length} are routes`);

  // nearest mapped path to each fall, and the routes that pass it
  const pidx = new Map();
  const cellOf = (lon, lat) => `${Math.floor(lon / 0.01)},${Math.floor(lat / 0.01)}`;
  for (const s of segs) { const k = cellOf(s[0], s[1]); (pidx.get(k) ?? pidx.set(k, []).get(k)).push(s); }
  const nearestPath = (lon, lat) => {
    let best = Infinity;
    const cx = Math.floor(lon / 0.01), cy = Math.floor(lat / 0.01);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++)
      for (const s of pidx.get(`${cx + dx},${cy + dy}`) ?? []) best = Math.min(best, Math.hypot((s[0] - lon) * MX, (s[1] - lat) * MY));
    return best;
  };
  const routeNear = (lon, lat, m) => routes.flatMap((r, i) => (r.parts.some((p) => p.some((q) => Math.hypot((q[0] - lon) * MX, (q[1] - lat) * MY) < m)) ? [i] : []));
  for (const f of falls) {
    f.elev = Math.round(Math.max(0, elevAt(f.lon, f.lat) ?? 0));
    const d = nearestPath(f.lon, f.lat);
    f.path = Number.isFinite(d) ? Math.round(d) : null;
    f.routes = routeNear(f.lon, f.lat, 600);
    delete f.wd;
  }
  for (const r of routes) r.falls = falls.flatMap((f, i) => (f.routes.includes(routes.indexOf(r)) ? [i] : []));
  log(`  waterfalls: ${falls.length}, ${falls.filter((f) => f.name).length} named, ${falls.filter((f) => f.img).length} with photos, ${falls.filter((f) => f.h).length} with heights`);

  // ---------------------------------------------------------------------------------------------
  // 7. per-place summaries

  const places = {};
  for (const p of PLACES) {
    let k10 = 0;
    for (const [lon, lat, len] of segs) if (Math.abs(lat - p.lat) < 0.1 && Math.abs(lon - p.lon) < 0.15 && distKm(p.lon, p.lat, lon, lat) <= 10) k10 += len;
    const fn = falls.map((f, i) => ({ i, d: distKm(p.lon, p.lat, f.lon, f.lat) })).filter((x) => x.d <= 30).sort((a, b) => a.d - b.d);
    const rn = routes.map((r, i) => ({ i, d: Math.min(...r.parts.flatMap((q) => q.map((c) => distKm(p.lon, p.lat, c[0], c[1])))) })).filter((x) => x.d <= 20).sort((a, b) => a.d - b.d);
    places[p.key] = {
      km10: round(k10 / 1000, 1),
      falls30: fn.length,
      falls: fn.slice(0, 4).map((x) => [x.i, round(x.d, 1)]),
      routes: rn.slice(0, 6).map((x) => [x.i, round(x.d, 1)]),
    };
  }

  await writeOut('trails', {
    source: 'OpenStreetMap contributors via the Overpass API (ODbL 1.0): hiking route relations, footpaths and named trail tracks, waterfalls; photos from Wikimedia Commons (each under its own licence) and Wikidata (CC0); elevations from Mapzen / AWS Terrain Tiles',
    netKm: Math.round(netKm),
    netPaths: ways.length,
    routes,
    falls,
    guide,
    places,
    grid: { west: BBOX.west, south: BBOX.south, d: GRID, nx: gnx, cells: [...dens].filter(([, v]) => v >= 20).map(([k, v]) => [k, Math.round(v)]) },
  });
  await writeOut('trails-net', { west: BBOX.west, south: BBOX.south, q: Q, names, ways });
}

// ---------------------------------------------------------------------------------------------
// geometry and terrain helpers

function dpLine(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Terrarium PNG tile -> Float32Array of 256x256 elevations in metres. */
function decodeTerrarium(buf) {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = 8, width = 0, height = 0, ctype = 0;
  const idat = [];
  while (pos < u8.length) {
    const len = (u8[pos] << 24) | (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3];
    const type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
    const data = u8.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]; height = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]; ctype = data[9]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  const all = new Uint8Array(idat.reduce((s, d) => s + d.length, 0));
  let o = 0;
  for (const d of idat) { all.set(d, o); o += d.length; }
  const raw = unzlibSync(all);
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : 4;
  const stride = width * bpp;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = px[i * bpp] * 256 + px[i * bpp + 1] + px[i * bpp + 2] / 256 - 32768;
  return out;
}
