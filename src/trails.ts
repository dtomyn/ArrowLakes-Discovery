// HIKES & WATERFALLS — the Arrow Lakes valley's footpaths as a living web of light (a spark for every
// hiker on the move), the guide's hikes and every named trail as routes with elevation profiles,
// waterfalls as beams of falling water, and the lookouts and hot springs along the lakes. A route can be
// flown in 3D over satellite imagery on real terrain, any stop orbited, and the whole guide toured as a
// road trip. Ported from Manitoulin Atlas; data from scripts/trails.mjs, the guide from hikes.ts.
import * as d3 from 'd3';
import * as maplibregl from 'maplibre-gl';
import { ColumnLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, MONTHS, Poi, TrailNet, TrailRoute, Trails, Waterfall, fmt, km, loadTrailNet } from './data';
import type { AtlasLayer, PanelHandle } from './layers';
import { esc, safeUrl } from './html';
import { GUIDE, GUIDE_KIND, GuideStop } from './hikes';

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => { const o = d3.rgb(c); return [o.r, o.g, o.b, a]; };
const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false } as const;
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;

export const TRAIL_COLOR = '#34d399';
const FALL_COLOR = '#8be3ff';
const LOOK_COLOR = '#c5e86c';
const LEVEL = { 1: { name: 'Easy', c: '#6ee7b7' }, 2: { name: 'Moderate', c: '#fcd34d' }, 3: { name: 'Harder', c: '#fb7185' } } as const;
const SAC_NAME = ['', 'hiking trail', 'mountain hiking', 'demanding'];
/** The guide as a road trip down the valley: Revelstoke, the Upper Arrow Lake, Nakusp, then south to Castlegar. */
const TOUR_ORDER = ['begbie-falls', 'mount-cartier', 'sutherland-falls', 'sproat', 'halfway', 'nakusp-hot-springs', 'saddle', 'syringa', 'waldie', 'zuckerberg', 'brilliant', 'merry-creek'];
const KIND_IC = { hike: '▲', falls: '≋', lookout: '◎', springs: '♨' } as const;
const photo = (file: string, w = 640) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${w}`;
const commonsPage = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`;
const wikiUrl = (w: string) => { const [lang, ...t] = w.split(':'); return /^[a-z]{2,3}(-[a-z]+)*$/i.test(lang) && t.length ? `https://${lang.toLowerCase()}.wikipedia.org/wiki/${encodeURIComponent(t.join(':').replace(/ /g, '_'))}` : null; };
const osmPage = (ref: string) => `https://www.openstreetmap.org/${ref.split('/').map(encodeURIComponent).join('/')}`;
const fallPage = (f: Waterfall) => (f.osm.startsWith('wikidata/') ? { url: `https://www.wikidata.org/wiki/${encodeURIComponent(f.osm.slice(9))}`, label: 'Wikidata' } : { url: osmPage(f.osm), label: 'OpenStreetMap' });
const fallName = (f: Waterfall) => f.name ?? 'Unnamed waterfall';
const hrsText = (h: number) => (h < 1 ? `${Math.max(5, Math.round((h * 60) / 5) * 5)} min` : `${h.toFixed(1).replace(/\.0$/, '')} h`);
const directions = (lon: number, lat: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}`;

// ---------------------------------------------------------------------------------------------
// geometry along a route's ordered line

type Geo = { cum: number[]; total: number; fallsAt: { i: number; d: number }[] };
const geoCache = new Map<TrailRoute, Geo>();
const kx = Math.cos((50.1 * Math.PI) / 180) * 111.32, ky = 110.54;
function geoOf(r: TrailRoute, falls: Waterfall[]): Geo {
  let g = geoCache.get(r);
  if (g) return g;
  const cum = [0];
  for (let i = 1; i < r.line.length; i++) cum.push(cum[i - 1] + Math.hypot((r.line[i][0] - r.line[i - 1][0]) * kx, (r.line[i][1] - r.line[i - 1][1]) * ky));
  const total = cum[cum.length - 1] || 0.001;
  const fallsAt = r.falls.map((i) => {
    const f = falls[i];
    let best = 0, bd = Infinity;
    r.line.forEach((p, k) => { const d = Math.hypot((p[0] - f.lon) * kx, (p[1] - f.lat) * ky); if (d < bd) { bd = d; best = k; } });
    return { i, d: cum[best] };
  });
  g = { cum, total, fallsAt };
  geoCache.set(r, g);
  return g;
}
function along(r: TrailRoute, g: Geo, d: number): [number, number] {
  d = Math.max(0, Math.min(g.total, d));
  let lo = 1, hi = g.cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (g.cum[m] < d) lo = m + 1; else hi = m; }
  const a = r.line[lo - 1], b = r.line[lo];
  const f = (d - g.cum[lo - 1]) / (g.cum[lo] - g.cum[lo - 1] || 1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
const elevAt = (r: TrailRoute, g: Geo, d: number) => {
  const x = (Math.max(0, Math.min(g.total, d)) / g.total) * (r.prof.length - 1);
  const i = Math.floor(x), f = x - i;
  return r.prof[i] + ((r.prof[Math.min(r.prof.length - 1, i + 1)] ?? r.prof[i]) - r.prof[i]) * f;
};
const bearingOf = (a: [number, number], b: [number, number]) => (Math.atan2((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) * 180) / Math.PI;
const lerpAngle = (a: number, b: number, k: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;
function boundsOf(pts: [number, number][]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) { w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}
const panelPad = () => ({ top: 90, bottom: 150, left: 60, right: document.body.classList.contains('no-panel') ? 60 : 440 });

// ---------------------------------------------------------------------------------------------
// the footpath network, decoded on first use

type NetPath = { path: [number, number][]; name: number; sac: number };
type FlowPath = { path: [number, number][]; ts: number[] };
let net: { paths: NetPath[]; flow: FlowPath[]; names: string[] } | null = null;
let netState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
const FLOW_PERIOD = 3200; // metres of "hiking" per loop
function decodeNet(j: TrailNet) {
  const paths: NetPath[] = [];
  const flow: FlowPath[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const w of j.ways) {
    const path: [number, number][] = [];
    let x = 0, y = 0;
    for (let k = 2; k < w.length; k += 2) { x += w[k]; y += w[k + 1]; path.push([j.west + x / j.q, j.south + y / j.q]); }
    if (path.length < 2) continue;
    paths.push({ path, name: w[0], sac: w[1] });
    // timestamps in metres along the path, chunked so each piece fits inside one loop; two hikers per piece
    let piece: [number, number][] = [path[0]], ts = [0], run = 0;
    const flush = () => {
      if (piece.length < 2) return;
      for (let h = 0; h < 2; h++) { const off = rand() * FLOW_PERIOD; flow.push({ path: piece, ts: ts.map((t) => t + off) }); }
    };
    for (let k = 1; k < path.length; k++) {
      run += Math.hypot((path[k][0] - path[k - 1][0]) * kx, (path[k][1] - path[k - 1][1]) * ky) * 1000;
      piece.push(path[k]); ts.push(run);
      if (run > FLOW_PERIOD * 0.4) { flush(); piece = [path[k]]; ts = [0]; run = 0; }
    }
    flush();
  }
  return { paths, flow, names: j.names };
}

// ---------------------------------------------------------------------------------------------
// module state

type View = { kind: 'overview' } | { kind: 'route'; i: number } | { kind: 'fall'; i: number } | { kind: 'stop'; id: string };
type Host = { map: maplibregl.Map; openPlace: (key: string) => void; setCinema: (on: boolean) => void };
let T: Trails | null = null;
let D: Data | null = null;
/** The lake's height: the highest monthly mean on record at the reservoir gauges (≈ full pool). */
const lakeLevel = () => d3.max((D?.water?.stations ?? []).filter((s) => s.lake === 'reservoir').flatMap((s) => Object.values(s.months))) ?? 440;
let view: View = { kind: 'overview' };
let levels = new Set<number>([1, 2, 3]);
let sortBy: 'featured' | 'long' | 'climb' = 'featured';
let hoverRoute: number | null = null;
let hoverD: number | null = null;
let panelEl: HTMLElement | null = null;
let host: Host | null = null;

/** Set once the map exists. */
export function bindTrails(h: Host) { host = h; }
/** True while the camera flies a route, orbits a stop or tours the guide over 3D terrain: deck.gl layers stand down. */
export const trailsCinema = () => !!flight || !!tour || !!orbit;

const guideOf = (id: string) => GUIDE.find((g) => g.id === id)!;
const extraOf = (g: GuideStop) => T?.guide?.[g.id] ?? { route: -1, fall: -1, img: null, elev: 0 };
const guideForRoute = (r: TrailRoute) => (r.guide ? guideOf(r.guide) : null);
const guideForFall = (i: number) => GUIDE.find((g) => extraOf(g).fall === i) ?? null;
/** Where a guide stop opens: its route, its waterfall, or a page of its own. */
const viewOfStop = (g: GuideStop): View => { const x = extraOf(g); return x.route >= 0 ? { kind: 'route', i: x.route } : x.fall >= 0 ? { kind: 'fall', i: x.fall } : { kind: 'stop', id: g.id }; };

// ---------------------------------------------------------------------------------------------
// the layer

export function hikesLayer(data: Data): AtlasLayer {
  T = data.trails;
  D = data;
  const routes = T?.routes ?? [];
  const falls = T?.falls ?? [];
  const pois = data.osm?.pois ?? [];
  // named lookouts from OpenStreetMap, less the ones the guide already marks
  const looks = pois.filter((p) => p[2] === 'viewpoint' && p[3] && !GUIDE.some((g) => km(g.lon, g.lat, p[0], p[1]) < 0.6));
  let beamScale = 1;
  const beamTop = (f: Waterfall) => (900 + Math.sqrt(f.h ?? 12) * 900) * beamScale;
  const routeColor = (r: TrailRoute) => LEVEL[r.level].c;

  const l: AtlasLayer = {
    id: 'hikes',
    name: 'Hikes & waterfalls',
    icon: '⛰',
    color: TRAIL_COLOR,
    range: [new Date().getFullYear(), new Date().getFullYear() + 0.99],
    static: true,
    period: 'trail guide · 3D',
    available: !!T,
    unavailable: 'The trail and waterfall data could not be downloaded when this copy of the data was built. Run <code>npm run data trails</code>, then reload.',
    build({ clock, focusedId }) {
      if (!T) return [];
      const focused = focusedId === 'hikes';
      if (netState === 'idle') {
        netState = 'loading';
        loadTrailNet().then((j) => { if (j) { net = decodeNet(j); netState = 'ready'; } else netState = 'failed'; });
      }
      const out: Layer[] = [];
      const sel = view.kind === 'route' ? view.i : null;
      const dim = sel != null || hoverRoute != null;

      // every footpath, faint, with sparks of light walking along it
      if (net) {
        out.push(
          new PathLayer<NetPath>({
            id: 'hikes-net-base', data: net.paths, getPath: (p) => p.path,
            getColor: (p) => (p.sac >= 2 ? [252, 211, 77, 80] : [52, 211, 153, p.name >= 0 ? 110 : 70]),
            getWidth: 1.2, widthUnits: 'pixels', widthMinPixels: 0.8, pickable: focused, parameters: ADDITIVE,
          } as any),
          new TripsLayer<FlowPath>({
            id: 'hikes-net-flow', data: net.flow, getPath: (p) => p.path, getTimestamps: (p) => p.ts,
            getColor: [200, 255, 230], currentTime: (clock * 0.22) % FLOW_PERIOD, trailLength: 160, fadeTrail: true,
            widthMinPixels: 2, capRounded: true, jointRounded: true, opacity: dim ? 0.35 : 0.85, parameters: ADDITIVE,
          } as any),
        );
      }

      // routes, coloured by effort: a soft glow under a crisp line
      const shown = routes.map((r, i) => ({ r, i })).filter((x) => levels.has(x.r.level));
      const parts = shown.flatMap(({ r, i }) => r.parts.map((p) => ({ p, r, i })));
      const isHot = (i: number) => i === sel || i === hoverRoute;
      out.push(
        new PathLayer<any>({
          id: 'hikes-routes-glow', data: parts, getPath: (d) => d.p,
          getColor: (d) => rgb(isHot(d.i) ? '#ffffff' : routeColor(d.r), isHot(d.i) ? 100 : dim ? 18 : 55),
          getWidth: (d) => (isHot(d.i) ? 18 : 11), widthUnits: 'pixels', capRounded: true, jointRounded: true,
          updateTriggers: { getColor: [sel, hoverRoute], getWidth: [sel, hoverRoute] }, parameters: ADDITIVE,
        } as any),
        new PathLayer<any>({
          id: 'hikes-routes', data: parts, getPath: (d) => d.p,
          getColor: (d) => rgb(isHot(d.i) ? '#ffffff' : routeColor(d.r), isHot(d.i) ? 255 : dim ? 90 : 235),
          getWidth: (d) => (isHot(d.i) ? 4 : 2.6), widthUnits: 'pixels', capRounded: true, jointRounded: true, pickable: true,
          updateTriggers: { getColor: [sel, hoverRoute], getWidth: [sel, hoverRoute] }, parameters: NO_DEPTH,
        } as any),
      );

      // the open route carries a train of light along its line
      if (sel != null) {
        const r = routes[sel], g = geoOf(r, falls);
        const n = Math.max(3, Math.min(10, Math.round(g.total / 0.8)));
        const loop = Math.max(2, g.total);
        const t = ((clock / 1000) * Math.max(0.15, g.total / 14)) % loop + loop * 0.999;
        for (const k of [0, 1])
          out.push(new TripsLayer<any>({
            id: `hikes-sel-flow${k}`, data: Array.from({ length: n }, (_, j) => ({ off: (j * loop) / n + k * loop })),
            getPath: () => r.line, getTimestamps: (d: any) => g.cum.map((c) => c + d.off), getColor: [255, 255, 255],
            currentTime: t, trailLength: Math.max(0.12, g.total / 20), fadeTrail: true, widthMinPixels: 4.5, capRounded: true,
            parameters: ADDITIVE, updateTriggers: { getTimestamps: sel },
          } as any));
        if (hoverD != null)
          out.push(new ScatterplotLayer<any>({
            id: 'hikes-cursor', data: [along(r, g, hoverD)], getPosition: (d) => d, getRadius: 7, radiusUnits: 'pixels',
            getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: rgb(TRAIL_COLOR), lineWidthMinPixels: 3, parameters: NO_DEPTH,
          } as any));
        const stepKm = g.total > 10 ? 2 : g.total > 3 ? 1 : 0.5;
        const ticks = d3.range(stepKm, g.total - stepKm * 0.3, stepKm).map((d) => ({ d, p: along(r, g, d) }));
        out.push(
          new ScatterplotLayer<any>({ id: 'hikes-km-dots', data: ticks, getPosition: (t) => t.p, getRadius: 3.5, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 230], stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 1, parameters: NO_DEPTH } as any),
          new TextLayer<any>({ id: 'hikes-km-labels', data: ticks, getPosition: (t) => t.p, getText: (t) => `${+t.d.toFixed(1)} km`, getSize: 10.5, getColor: [235, 245, 240, 235], getPixelOffset: [8, 0], getTextAnchor: 'start', getAlignmentBaseline: 'center', fontFamily: 'Inter, sans-serif', fontWeight: 600, characterSet: 'auto', outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true }, parameters: { depthCompare: 'always' } } as any),
        );
        out.push(new ScatterplotLayer<any>({
          id: 'hikes-ends', data: r.loop ? [r.line[0]] : [r.line[0], r.line[r.line.length - 1]], getPosition: (d) => d,
          getRadius: 6, radiusUnits: 'pixels', getFillColor: [6, 10, 18, 255], stroked: true, getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2.5, parameters: NO_DEPTH,
        } as any));
      }

      // waterfalls: a beam each, water falling down it, mist rippling at the foot
      const fsel = view.kind === 'fall' ? falls[view.i] : null;
      const zs = Math.max(0.07, Math.min(1, 2 ** (8.8 - (host?.map.getZoom() ?? 8.8))));
      beamScale = Math.round(zs * 50) / 50;
      const ph = clock / 1600;
      out.push(
        new ColumnLayer<Waterfall>({
          id: 'hikes-falls-beam', data: falls, getPosition: (f) => [f.lon, f.lat], radius: 170 * Math.max(0.25, beamScale), diskResolution: 12, extruded: true,
          getElevation: (f) => beamTop(f), getFillColor: (f) => (f === fsel ? [255, 255, 255, 160] : rgb(FALL_COLOR, 95)),
          material: { ambient: 1, diffuse: 0.2, shininess: 0 }, pickable: true,
          updateTriggers: { getFillColor: fsel, getElevation: beamScale }, parameters: ADDITIVE,
        } as any),
        new ScatterplotLayer<any>({
          id: 'hikes-falls-drops', data: falls.flatMap((f) => Array.from({ length: 12 }, (_, k) => ({ f, q: (ph + k / 12) % 1 }))),
          getPosition: (d) => [d.f.lon, d.f.lat, beamTop(d.f) * (1 - d.q * d.q)], getRadius: 130, radiusMinPixels: 1.4, radiusMaxPixels: 3.2,
          getFillColor: (d) => [220, 248, 255, 255 * Math.sin(Math.PI * d.q)], billboard: true,
          updateTriggers: { getPosition: [ph, beamScale], getFillColor: ph }, parameters: ADDITIVE,
        } as any),
        new ScatterplotLayer<any>({
          id: 'hikes-falls-mist', data: falls.flatMap((f) => [0, 0.5].map((o) => ({ f, q: (clock / 2600 + o) % 1 }))),
          getPosition: (d) => [d.f.lon, d.f.lat], getRadius: (d) => (250 + d.q * 2200) * Math.max(0.15, beamScale), stroked: true, filled: false, lineWidthMinPixels: 1.3,
          getLineColor: (d) => rgb(FALL_COLOR, 170 * (1 - d.q)), updateTriggers: { getRadius: clock, getLineColor: clock }, parameters: NO_DEPTH,
        } as any),
      );

      // lookouts: small lime points
      out.push(new ScatterplotLayer<Poi>({
        id: 'hikes-looks', data: looks, getPosition: (p) => [p[0], p[1]], getRadius: 180, radiusMinPixels: 3, radiusMaxPixels: 6,
        getFillColor: rgb(LOOK_COLOR, 210), stroked: true, getLineColor: [6, 10, 18, 220], lineWidthMinPixels: 1, pickable: true, parameters: NO_DEPTH,
      } as any));

      // the guide: a marker and a label per stop; the open one pulses
      const openId = view.kind === 'stop' ? view.id : view.kind === 'route' ? routes[view.i]?.guide : view.kind === 'fall' ? guideForFall(view.i)?.id : null;
      const pulse = (clock % 1600) / 1600;
      out.push(
        new ScatterplotLayer<GuideStop>({
          id: 'hikes-stops-glow', data: GUIDE, getPosition: (g) => [g.lon, g.lat], getRadius: 900, radiusMinPixels: 10, radiusMaxPixels: 24,
          getFillColor: (g) => rgb(GUIDE_KIND[g.kind].color, 55), parameters: ADDITIVE,
        } as any),
        new ScatterplotLayer<GuideStop>({
          id: 'hikes-stops', data: GUIDE, getPosition: (g) => [g.lon, g.lat], getRadius: 300, radiusMinPixels: 5.5, radiusMaxPixels: 9,
          getFillColor: (g) => rgb(GUIDE_KIND[g.kind].color, 250), stroked: true, getLineColor: [6, 10, 18, 230], lineWidthMinPixels: 1.5,
          pickable: true, parameters: { depthCompare: 'always' },
        } as any),
        new ScatterplotLayer<GuideStop>({
          id: 'hikes-picked', data: GUIDE.filter((g) => g.id === openId), getPosition: (g) => [g.lon, g.lat], getRadius: 300 + pulse * 900,
          stroked: true, filled: false, lineWidthMinPixels: 2, getLineColor: [255, 255, 255, 240 * (1 - pulse)],
          updateTriggers: { getRadius: pulse, getLineColor: pulse }, parameters: ADDITIVE,
        } as any),
        new TextLayer<GuideStop>({
          id: 'hikes-labels', data: focused ? GUIDE : [], pickable: true, getPosition: (g) => [g.lon, g.lat, g.kind === 'falls' ? 600 : 0],
          getText: (g) => g.name, getSize: (g) => (g.id === openId ? 14.5 : 11.5), getColor: [235, 245, 240, 240], getPixelOffset: [0, -13],
          getAlignmentBaseline: 'bottom', fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto', outlineWidth: 3,
          outlineColor: [6, 10, 18, 225], fontSettings: { sdf: true }, updateTriggers: { getSize: openId }, parameters: { depthCompare: 'always' },
        } as any),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      panelEl = el;
      renderPanel(el);
      return { update() {} } as PanelHandle;
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      const o: any = info.object;
      if (!o) return null;
      if (id === 'hikes-routes') {
        const r = o.r as TrailRoute;
        return `<b>${esc(r.name)}</b><br><span class="tk">${LEVEL[r.level].name}</span> <span class="tv">${r.km} km · ↑${fmt.int(r.up)} m</span><br><span class="tk">about ${hrsText(r.hrs)}${r.loop ? ', loop' : ''}</span><br><span class="tk">Click for the profile and the 3D flight</span>`;
      }
      if (id === 'hikes-falls-beam') {
        const f = o as Waterfall;
        return `<b>${esc(fallName(f))}</b>${f.h ? `<br><span class="tk">Drop</span> <span class="tv">${Math.round(f.h)} m</span>` : ''}<br><span class="tk">${fmt.int(f.elev)} m above sea level${f.path != null && f.path < 2000 ? ` · ${f.path < 60 ? 'on a mapped trail' : `${fmt.int(f.path)} m from a trail`}` : ''}</span><br><span class="tk">Click to open${f.img ? ' · 📷 photo' : ''}</span>`;
      }
      if (id === 'hikes-stops') {
        const g = o as GuideStop;
        return `<b>${esc(g.name)}</b><br><span class="tk">${GUIDE_KIND[g.kind].label} · ${esc(g.effort)} · ${esc(g.near)}</span><br><span class="tk">${esc(g.note)}</span>`;
      }
      if (id === 'hikes-looks') return `<b>${esc((o as Poi)[3] ?? 'Lookout')}</b><br><span class="tk">Lookout · OpenStreetMap</span>`;
      if (id === 'hikes-net-base' && net) {
        const p = o as NetPath;
        return `<b>${p.name >= 0 ? esc(net.names[p.name]) : 'Footpath'}</b>${p.sac ? `<br><span class="tk">${SAC_NAME[p.sac]}</span>` : ''}`;
      }
      return null;
    },
  };
  l.click = (info: PickingInfo) => {
    const id = info.layer?.id ?? '';
    const o: any = info.object;
    if (!o) return false;
    if (id === 'hikes-routes') { openHikeView({ kind: 'route', i: o.i }); return true; }
    if (id === 'hikes-falls-beam') { openHikeView({ kind: 'fall', i: falls.indexOf(o) }); return true; }
    if (id === 'hikes-stops' || id === 'hikes-labels') { openHikeView(viewOfStop(o)); return true; }
    if (id === 'hikes-looks') { host?.map.flyTo({ center: [o[0], o[1]], zoom: Math.max(host.map.getZoom(), 12.5), pitch: 55, duration: 1600, essential: true }); return true; }
    return false;
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// panels

/** Asks the app to open a route, waterfall or stop: it focuses the hikes layer and opens the panel first. */
export const openHikeView = (v: View) => window.dispatchEvent(new CustomEvent('atlas:hike', { detail: v }));

/** What a trail or waterfall drawn by another layer (Valley life) opens here, if anything. */
export function hikeViewAt(kind: 'trail' | 'fall', lon: number, lat: number): View | null {
  if (!T) return null;
  if (kind === 'fall') { const i = T.falls.findIndex((f) => km(f.lon, f.lat, lon, lat) < 0.4); if (i >= 0) return { kind: 'fall', i }; }
  let best = -1, bd = 0.15;
  T.routes.forEach((r, i) => { for (const p of r.parts.flat()) { const d = km(p[0], p[1], lon, lat); if (d < bd) { bd = d; best = i; } } });
  return best >= 0 ? { kind: 'route', i: best } : null;
}

/** Opens a route, waterfall or guide stop in the panel and flies the map to it. */
export function go(v: View, fly = true, render = true) {
  view = v;
  hoverD = null;
  if (fly && host && T) {
    const m = host.map;
    if (v.kind === 'route') m.fitBounds(boundsOf(T.routes[v.i].parts.flat()), { padding: panelPad(), pitch: 55, bearing: m.getBearing(), duration: 1800, maxZoom: 14.5, essential: true });
    else if (v.kind === 'fall') { const f = T.falls[v.i]; m.flyTo({ center: [f.lon, f.lat], zoom: Math.max(m.getZoom(), 13), pitch: 60, duration: 1800, essential: true }); }
    else if (v.kind === 'stop') { const g = guideOf(v.id); m.flyTo({ center: [g.lon, g.lat], zoom: Math.max(m.getZoom(), 12.8), pitch: 60, duration: 1800, essential: true }); }
  }
  if (!panelEl || !render) return;
  const p = panelEl;
  p.classList.add('swap');
  setTimeout(() => { p.scrollTop = 0; renderPanel(p); p.classList.remove('swap'); }, 160);
}

function renderPanel(el: HTMLElement) {
  if (!T) {
    el.innerHTML = `<div class="kicker" style="--c:${TRAIL_COLOR}">Hikes &amp; waterfalls</div><h2>Into the mountains</h2><div class="unavail">The trail and waterfall data could not be downloaded when this copy of the data was built. Run <code>npm run data trails</code>, then reload.</div>`;
    return;
  }
  if (view.kind !== 'overview') return renderReport(el, view);
  renderOverview(el);
}

/** A small inline elevation silhouette, scaled to a shared relief so flat walks look flat. */
function miniProfile(r: TrailRoute, w = 92, h = 26) {
  const relief = Math.max(r.hi - r.lo, 1);
  const scale = Math.min(1, relief / 160);
  const pts = r.prof.filter((_, i) => i % Math.max(1, Math.floor(r.prof.length / 46)) === 0);
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * w;
  const y = (v: number) => h - 2 - ((v - r.lo) / relief) * (h - 4) * Math.max(0.1, scale);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return `<svg class="tr-mini" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="--c:${LEVEL[r.level].c}"><path class="a" d="${line}L${w},${h}L0,${h}Z"/><path class="l" d="${line}"/></svg>`;
}

/** A guide stop's picture: its photo, or a glowing stand-in in its colour. */
function thumb(g: GuideStop, w = 160) {
  const img = extraOf(g).img;
  return img ? `<img loading="lazy" alt="" src="${photo(img, w)}">` : `<span class="tr-ph-none" style="--c:${GUIDE_KIND[g.kind].color}">${KIND_IC[g.kind]}</span>`;
}

function placeScores() {
  const rows = D!.places.flatMap((p) => { const t = T!.places?.[p.key]; return t ? [{ p, t }] : []; });
  const rk = (vals: number[]) => { const s = [...vals].sort((a, b) => a - b); return (v: number) => s.findIndex((x) => x >= v) / Math.max(1, s.length - 1); };
  const near = (t: (typeof rows)[number]['t']) => t.routes.filter(([, d]) => d <= 10).length;
  const a = rk(rows.map((r) => r.t.km10)), b = rk(rows.map((r) => near(r.t)));
  return rows.map((r) => ({ ...r, near: near(r.t), s: 0.6 * a(r.t.km10) + 0.4 * b(near(r.t)) })).sort((x, y) => y.s - x.s);
}

function renderOverview(el: HTMLElement) {
  const routes = T!.routes, falls = T!.falls;
  const order = routes.map((r, i) => ({ r, i })).filter((x) => levels.has(x.r.level));
  const key = { featured: (x: { r: TrailRoute }) => -((x.r.guide ? 100 : 0) + x.r.km + x.r.up / 20), long: (x: { r: TrailRoute }) => -x.r.km, climb: (x: { r: TrailRoute }) => -x.r.up }[sortBy];
  order.sort((a, b) => key(a) - key(b));
  const top = [...routes].sort((a, b) => b.hi - a.hi)[0];
  const featured = routes.find((r) => r.guide === 'saddle') ?? [...routes].sort((a, b) => b.up - a.up)[0];
  const photos = GUIDE.filter((g) => extraOf(g).img);
  const looksN = (D!.osm?.pois ?? []).filter((p) => p[2] === 'viewpoint').length;
  const places = placeScores().slice(0, 8);

  el.innerHTML = `
    <div class="kicker" style="--c:${TRAIL_COLOR}">Hikes &amp; waterfalls · trail guide in 3D</div>
    <h2>Into the mountains</h2>
    <p class="lede">The lakes sit deep between the Monashee and Selkirk mountains, so the walks here either follow the shore and the creeks or climb hard to old fire lookouts. Every mapped footpath glows, with a <b>spark for each hiker</b> on the move; the <b>bright lines</b> are ${routes.length} routes, coloured by effort; <b>beams of light</b> are waterfalls. Fly any trail in <b>3D over satellite imagery</b>, or take the whole guide as a road trip.</p>
    <div class="hero">
      <div class="stat"><div class="v">${fmt.int(T!.netKm)} km</div><div class="l">of mapped footpath</div></div>
      <div class="stat"><div class="v">${routes.length}</div><div class="l">routes with elevation profiles</div></div>
      <div class="stat"><div class="v">${top ? `${fmt.int(top.hi)} m` : '–'}</div><div class="l">${top ? `high point: ${esc(top.name)}` : ''}</div></div>
      <div class="stat"><div class="v">${falls.length} · ${looksN}</div><div class="l">waterfalls · lookouts</div></div>
    </div>
    <div class="tr-cta">
      <button class="tr-big" data-act="tour"><span class="tr-big-ic">▶</span><span><b>Valley highlights tour</b><br><small>A 3D road trip to all ${GUIDE.length} stops, Revelstoke to Castlegar</small></span></button>
      ${featured ? `<button class="tr-big alt" data-act="fly-featured"><span class="tr-big-ic">✈</span><span><b>Fly the ${esc(featured.name)}</b><br><small>${featured.km} km · ↑${fmt.int(featured.up)} m over the real terrain</small></span></button>` : ''}
    </div>
    <h3>The guide</h3>
    <div class="tr-guide">${GUIDE.map((g) => {
      const x = extraOf(g), r = x.route >= 0 ? routes[x.route] : null;
      return `<button class="tr-gcard" data-stop="${g.id}" style="--c:${GUIDE_KIND[g.kind].color}"><span class="tr-gimg">${thumb(g)}</span><span class="tr-gtxt"><span class="tr-gk">${KIND_IC[g.kind]} ${GUIDE_KIND[g.kind].label} · ${esc(g.effort)}</span><b>${esc(g.name)}</b><small>${r ? `${r.km} km · ↑${fmt.int(r.up)} m · ${hrsText(r.hrs)} · ` : ''}${esc(g.near)}</small></span>${r ? miniProfile(r, 64, 22) : ''}</button>`;
    }).join('')}</div>
    <h3>Every route</h3>
    <div class="chip-row"><span class="chip-k">Effort</span><div class="chips">${([1, 2, 3] as const).map((k) => `<button class="chip${levels.has(k) ? ' on' : ''}" data-level="${k}" style="--c:${LEVEL[k].c}">${LEVEL[k].name} · ${routes.filter((r) => r.level === k).length}</button>`).join('')}</div></div>
    <div class="chip-row"><span class="chip-k">Sort</span><div class="chips">${(['featured', 'long', 'climb'] as const).map((k) => `<button class="chip${sortBy === k ? ' on' : ''}" data-sort="${k}" style="--c:${TRAIL_COLOR}">${{ featured: 'Featured', long: 'Longest', climb: 'Most climbing' }[k]}</button>`).join('')}</div></div>
    <ol class="tr-routes">${order.map(({ r, i }) => `<li data-route="${i}" style="--c:${LEVEL[r.level].c}"><span class="tr-lv"></span><span class="tr-nm"><b>${esc(r.name)}</b><small>${r.km} km · ↑${fmt.int(r.up)} m · ${hrsText(r.hrs)}${r.loop ? ' · loop' : ''}${r.falls.length ? ` · <span class="tr-fc">💧${r.falls.length}</span>` : ''}</small></span>${miniProfile(r)}</li>`).join('')}</ol>
    ${photos.length ? `<h3>Photos from the guide</h3><div class="tr-gallery">${photos.map((g) => `<button class="tr-ph" data-stop="${g.id}"><img loading="lazy" alt="" src="${photo(extraOf(g).img!, 360)}"><span><b>${esc(g.name)}</b><small>${GUIDE_KIND[g.kind].label}</small></span></button>`).join('')}</div>` : ''}
    <h3>Places closest to the trails</h3>
    <ol class="rank-list">${places.map((x, k) => `<li data-place="${esc(x.p.key)}"><span class="rk">${k + 1}</span><span><span class="nm">${esc(x.p.name)}</span><br><span class="rd">${x.t.km10} km of path within 10 km · ${x.near} route${x.near === 1 ? '' : 's'} within 10 km</span></span><span><div class="bar"><i style="width:${Math.round(x.s * 100)}%;background:${TRAIL_COLOR}"></i></div><div class="bar-v">${Math.round(x.s * 100)}</div></span></li>`).join('')}</ol>
    <div class="legend"><span><i class="sw" style="background:${LEVEL[1].c}"></i>easy</span><span><i class="sw" style="background:${LEVEL[2].c}"></i>moderate</span><span><i class="sw" style="background:${LEVEL[3].c}"></i>harder</span><span><i class="sw" style="background:${FALL_COLOR}"></i>waterfall</span><span><i class="sw" style="background:${LOOK_COLOR}"></i>lookout</span></div>
    <p class="note">Guide routes join every trail OpenStreetMap maps under that name, so a route with several loops is the sum of them. Time is Naismith’s rule (4.5 km an hour, plus an hour for every 600 m up); climbing comes from ~25 m terrain tiles, so short steep pitches are smoothed out. Trails cross private, park and First Nation land: follow posted rules and check conditions before you go. Waterfalls run strongest in spring.</p>
    <div class="source">Source: ${esc(T!.source)}.${netState === 'failed' ? ' The full path network could not be loaded.' : ''}</div>`;

  el.querySelectorAll<HTMLElement>('[data-level]').forEach((b) => b.addEventListener('click', () => {
    const k = +b.dataset.level!;
    if (levels.has(k) && levels.size > 1) levels.delete(k); else levels.add(k);
    renderOverview(el);
  }));
  el.querySelectorAll<HTMLElement>('[data-sort]').forEach((b) => b.addEventListener('click', () => { sortBy = b.dataset.sort as typeof sortBy; renderOverview(el); }));
  el.querySelector('[data-act="tour"]')?.addEventListener('click', () => startTour());
  el.querySelector('[data-act="fly-featured"]')?.addEventListener('click', () => { const i = routes.indexOf(featured); view = { kind: 'route', i }; renderPanel(el); startFlight(i); });
  const ul = el.querySelector('.tr-routes')!;
  ul.addEventListener('click', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-route]'); if (li) go({ kind: 'route', i: +li.dataset.route! }); });
  ul.addEventListener('mouseover', (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>('[data-route]'); hoverRoute = li ? +li.dataset.route! : null; });
  ul.addEventListener('mouseleave', () => { hoverRoute = null; });
  el.querySelectorAll<HTMLElement>('[data-stop]').forEach((b) => {
    const g = guideOf(b.dataset.stop!);
    b.addEventListener('click', () => go(viewOfStop(g)));
    const ri = extraOf(g).route;
    if (ri >= 0) { b.addEventListener('mouseenter', () => { hoverRoute = ri; }); b.addEventListener('mouseleave', () => { hoverRoute = null; }); }
  });
  el.querySelectorAll<HTMLElement>('[data-place]').forEach((b) => b.addEventListener('click', () => host?.openPlace(b.dataset.place!)));
}

const nearestPlace = (lon: number, lat: number) => D!.places.map((p) => ({ p, d: km(p.lon, p.lat, lon, lat) })).sort((a, b) => a.d - b.d)[0];

// ---------------------------------------------------------------------------------------------
// the Trail Report: one rich page for a route, a waterfall or a guide stop

/** What a report is about, whatever kind of thing was clicked. */
type Subject = {
  kind: 'route' | 'fall' | 'stop'; name: string; lon: number; lat: number; color: string; kindLabel: string; effort: string | null;
  guide: GuideStop | null; route: TrailRoute | null; ri: number; fall: Waterfall | null; img: string | null; elev: number;
};
function subjectOf(v: View): Subject | null {
  if (!T) return null;
  if (v.kind === 'route') {
    const r = T.routes[v.i];
    if (!r) return null;
    const gd = guideForRoute(r);
    return { kind: 'route', name: r.name, lon: r.line[0][0], lat: r.line[0][1], color: LEVEL[r.level].c, kindLabel: gd ? GUIDE_KIND[gd.kind].label : 'Trail', effort: gd?.effort ?? LEVEL[r.level].name, guide: gd, route: r, ri: v.i, fall: r.falls.length ? T.falls[r.falls[0]] : null, img: gd ? extraOf(gd).img : null, elev: r.prof[0] };
  }
  if (v.kind === 'fall') {
    const f = T.falls[v.i];
    if (!f) return null;
    const gd = guideForFall(v.i);
    return { kind: 'fall', name: fallName(f), lon: f.lon, lat: f.lat, color: FALL_COLOR, kindLabel: 'Waterfall', effort: gd?.effort ?? null, guide: gd, route: null, ri: -1, fall: f, img: f.img ?? (gd ? extraOf(gd).img : null), elev: f.elev };
  }
  if (v.kind === 'stop') {
    const g = guideOf(v.id), x = extraOf(g);
    return { kind: 'stop', name: g.name, lon: g.lon, lat: g.lat, color: GUIDE_KIND[g.kind].color, kindLabel: GUIDE_KIND[g.kind].label, effort: g.effort, guide: g, route: null, ri: -1, fall: null, img: x.img, elev: x.elev };
  }
  return null;
}

// --- satellite "from above" mosaic, with the trail drawn on it ---------------------------------

const ESRI = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const wpx = (lon: number, lat: number, z: number): [number, number] => {
  const s = 256 * 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
};
function satellite(s: Subject, cls: string) {
  const W = 400, H = 230;
  const pts = s.route ? s.route.parts.flat() : [[s.lon, s.lat] as [number, number]];
  const [[w, so], [e, n]] = boundsOf(pts);
  let z = 16;
  if (s.route) {
    const [x0, y0] = wpx(w, n, 0), [x1, y1] = wpx(e, so, 0);
    z = Math.floor(Math.log2(Math.min((W - 90) / Math.max(1e-9, x1 - x0), (H - 70) / Math.max(1e-9, y1 - y0))));
    z = Math.max(11, Math.min(17, z));
  }
  const [gx, gy] = wpx((w + e) / 2, (so + n) / 2, z);
  const tx0 = Math.floor((gx - W / 2 - 20) / 256), tx1 = Math.floor((gx + W / 2 + 20) / 256);
  const ty0 = Math.floor((gy - H / 2 - 20) / 256), ty1 = Math.floor((gy + H / 2 + 20) / 256);
  const ox = tx0 * 256, oy = ty0 * 256, gw = (tx1 - tx0 + 1) * 256, gh = (ty1 - ty0 + 1) * 256;
  const tiles: string[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push(`<img alt="" loading="lazy" style="left:${(tx - tx0) * 256}px;top:${(ty - ty0) * 256}px" src="${ESRI(z, tx, ty)}">`);
  const P = (lon: number, lat: number) => { const [x, y] = wpx(lon, lat, z); return [(x - ox).toFixed(1), (y - oy).toFixed(1)].join(','); };
  let svg = '';
  if (s.route) {
    const d = s.route.parts.map((p) => `M${p.map(([lo, la]) => P(lo, la)).join('L')}`).join('');
    const [sx, sy] = P(s.route.line[0][0], s.route.line[0][1]).split(',');
    svg = `<path class="sg" d="${d}"/><path class="sl" d="${d}" style="stroke:${s.color}"/><circle class="sh" cx="${sx}" cy="${sy}" r="6"/>`;
  } else {
    const [px, py] = P(s.lon, s.lat).split(',');
    svg = `<circle class="sp" cx="${px}" cy="${py}" r="8" style="stroke:${s.color}"/><circle class="sp2" cx="${px}" cy="${py}" r="8" style="stroke:${s.color}"/><circle class="sc" cx="${px}" cy="${py}" r="5" style="fill:${s.color}"/>`;
  }
  return `<div class="trp-sat ${cls}"><div class="trp-sat-in" style="width:${gw}px;height:${gh}px;left:calc(50% - ${(gx - ox).toFixed(0)}px);top:calc(50% - ${(gy - oy).toFixed(0)}px)">${tiles.join('')}<svg width="${gw}" height="${gh}">${svg}</svg></div><span class="trp-sat-cr">Imagery © Esri, Maxar, Earthstar Geographics</span></div>`;
}

// --- sun times (after the suncalc formulas) ---------------------------------------------------

function sunTimes(date: Date, lat: number, lon: number) {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, e = rad * 23.4397;
  const d = date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const lw = rad * -lon, phi = rad * lat;
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const set = J2000 + J0 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const rise = noon - (set - noon);
  const toDate = (j: number) => new Date((j + 0.5 - J1970) * dayMs);
  return { rise: toDate(rise), set: toDate(set) };
}
const clockTime = (d: Date) => d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' });

// --- pieces of the report ----------------------------------------------------------------------

/** 0–100: how much of a day out this is, from time on foot and climbing. */
const effortScore = (s: Subject) => (s.route ? Math.max(4, Math.min(100, s.route.hrs * 14 + s.route.up / 6)) : ({ Easy: 18, Moderate: 48, 'Moderate to hard': 74 } as Record<string, number>)[s.effort ?? ''] ?? 15);
function gauge(score: number, label: string, color: string) {
  const R = 54, cx = 70, cy = 66, a0 = Math.PI, a = Math.PI * (1 - score / 100);
  const arc = (from: number, to: number) => `M${cx + R * Math.cos(from)},${cy - R * Math.sin(from)}A${R},${R} 0 0 1 ${cx + R * Math.cos(to)},${cy - R * Math.sin(to)}`;
  return `<svg class="trp-gauge" viewBox="0 0 140 82" width="130" height="76">
    <defs><linearGradient id="trp-g" x1="0" x2="1"><stop offset="0" stop-color="#6ee7b7"/><stop offset=".55" stop-color="#fcd34d"/><stop offset="1" stop-color="#fb7185"/></linearGradient></defs>
    <path d="${arc(a0, 0)}" class="tg-bg"/><path d="${arc(a0, Math.max(0.001, a))}" class="tg-fg" pathLength="1"/>
    <g class="tg-needle" style="--deg:${(score / 100) * 180 - 90}deg;transform-origin:${cx}px ${cy}px"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R + 10}"/><circle cx="${cx}" cy="${cy}" r="4.5"/></g>
    <text x="${cx}" y="${cy + 11}" class="tg-l"><tspan class="tg-v">${Math.round(score)}</tspan><tspan dx="5" style="fill:${color}">${esc(label)}</tspan></text></svg>`;
}

function terrainMix(r: TrailRoute) {
  const n = r.prof.length, step = (r.lineKm * 1000) / Math.max(1, n - 1);
  let flat = 0, roll = 0, steep = 0;
  for (let i = 1; i < n; i++) { const g = Math.abs(r.prof[i] - r.prof[i - 1]) / Math.max(1, step); if (g < 0.03) flat++; else if (g < 0.08) roll++; else steep++; }
  const tot = Math.max(1, flat + roll + steep);
  // steepest ~100 m stretch
  const k = Math.max(1, Math.round(100 / Math.max(1, step)));
  let best = 0, at = 0;
  for (let i = k; i < n; i++) { const g = (r.prof[i] - r.prof[i - k]) / (k * step); if (Math.abs(g) > Math.abs(best)) { best = g; at = i; } }
  return { flat: flat / tot, roll: roll / tot, steep: steep / tot, steepest: best, steepAt: (at / Math.max(1, n - 1)) * r.lineKm };
}

type Waypoint = { d: number; ic: string; c: string; t: string; sub: string; lon: number; lat: number };
function waypoints(s: Subject): Waypoint[] {
  const r = s.route!, g = geoOf(r, T!.falls);
  const out: Waypoint[] = [];
  const s0 = r.line[0];
  out.push({ d: 0, ic: '⚑', c: '#ffffff', t: r.loop ? 'Trailhead · start and finish' : 'Trailhead', sub: `${fmt.int(r.prof[0])} m above sea level`, lon: s0[0], lat: s0[1] });
  // lookouts within 250 m of the line: the guide's, and any OpenStreetMap viewpoint
  const looks: { lon: number; lat: number; name: string }[] = [
    ...GUIDE.filter((x) => x.kind === 'lookout').map((x) => ({ lon: x.lon, lat: x.lat, name: x.name })),
    ...(D!.osm?.pois ?? []).filter((p) => p[2] === 'viewpoint').sort((a, b) => (b[3] ? 1 : 0) - (a[3] ? 1 : 0)).map((p) => ({ lon: p[0], lat: p[1], name: p[3] ?? 'Lookout' })),
  ];
  const seen: [number, number][] = [];
  for (const L of looks) {
    let bd = Infinity, bi = 0;
    r.line.forEach((p, i) => { const dd = Math.hypot((p[0] - L.lon) * kx, (p[1] - L.lat) * ky); if (dd < bd) { bd = dd; bi = i; } });
    if (bd > 0.25 || seen.some(([x, y]) => km(x, y, L.lon, L.lat) < 0.3)) continue;
    seen.push([L.lon, L.lat]);
    out.push({ d: g.cum[bi], ic: '◎', c: LOOK_COLOR, t: L.name, sub: `lookout · ${fmt.int(elevAt(r, g, g.cum[bi]))} m`, lon: L.lon, lat: L.lat });
  }
  for (const fa of g.fallsAt) { const f = T!.falls[fa.i]; out.push({ d: fa.d, ic: '≋', c: FALL_COLOR, t: fallName(f), sub: 'waterfall', lon: f.lon, lat: f.lat }); }
  const top = r.prof.indexOf(r.hi), dTop = (top / Math.max(1, r.prof.length - 1)) * g.total, pTop = along(r, g, dTop);
  if (r.hi - r.lo > 15) out.push({ d: dTop, ic: '▲', c: '#fcd34d', t: 'High point', sub: `${fmt.int(r.hi)} m · ${fmt.int(r.hi - lakeLevel())} m above the lake`, lon: pTop[0], lat: pTop[1] });
  if (!r.loop) { const e = r.line[r.line.length - 1]; out.push({ d: g.total, ic: '⚐', c: '#ffffff', t: 'End of the mapped trail', sub: `${fmt.int(r.prof[r.prof.length - 1])} m · head back the way you came`, lon: e[0], lat: e[1] }); }
  return out.sort((a, b) => a.d - b.d);
}

function whenToGo(s: Subject) {
  const st = D!.normals?.stations?.[0];
  if (!st) return '';
  const tMax = st.monthly.tMax as (number | null)[], snow = st.monthly.snow as (number | null)[], pr = st.monthly.precip as (number | null)[];
  const best = tMax.map((t, i) => (t ?? -99) >= 15 && (snow[i] ?? 9) < 1);
  const first = best.indexOf(true), last = best.lastIndexOf(true);
  const flow = s.kind === 'fall' || s.guide?.kind === 'falls';
  const bars = MONTHS.map((m, i) => {
    const t = tMax[i] ?? 0, h = Math.max(4, Math.min(100, ((t + 10) / 42) * 100));
    const c = t >= 15 && t <= 27 ? '#6ee7b7' : t > 27 ? '#fcd34d' : t > 3 ? '#8be3ff' : '#6c8cff';
    const tag = flow && (i === 3 || i === 4) ? '<em>💧</em>' : (snow[i] ?? 0) >= 5 ? '<em>❄</em>' : '';
    return `<div class="trp-m${best[i] ? ' best' : ''}" title="${m}: average high ${t.toFixed(0)} °C, ${Math.round(pr[i] ?? 0)} mm precipitation${(snow[i] ?? 0) > 0 ? `, ${Math.round(snow[i]!)} cm snow` : ''}"><span class="trp-mb" style="height:${h.toFixed(0)}%;background:${c}"></span>${tag}<b>${m[0]}</b></div>`;
  }).join('');
  const now = new Date().getMonth();
  return `<h3>When to go</h3>
    <div class="trp-months" style="--now:${now}">${bars}</div>
    <p class="trp-small">${first >= 0 ? `<b>Best walking: ${MONTHS[first]}–${MONTHS[last]}</b>, when highs reach ${Math.round(tMax[first] ?? 0)}–${Math.round(Math.max(...tMax.map((x) => x ?? 0)))} °C and the snow has gone. ` : ''}${flow ? 'Falls run hardest during the snowmelt (💧 April–May) and can dwindle by late summer. ' : s.route && s.route.hi > 1400 ? 'Higher trails hold snow well into July: these months are for the valley floor. ' : ''}${MONTHS[now]} averages a high of ${Math.round(tMax[now] ?? 0)} °C${(snow[now] ?? 0) > 1 ? ` and ${Math.round(snow[now]!)} cm of snow` : ''}.</p>`;
}

function todayLight(s: Subject) {
  const now = new Date();
  const { rise, set } = sunTimes(now, s.lat, s.lon);
  if (!Number.isFinite(rise.valueOf()) || !Number.isFinite(set.valueOf())) return '';
  const dayH = (set.valueOf() - rise.valueOf()) / 36e5;
  const left = (set.valueOf() - now.valueOf()) / 36e5;
  const need = s.route ? s.route.hrs * 1.2 + 0.25 : 0.75;
  const startBy = new Date(set.valueOf() - need * 36e5);
  const frac = Math.max(0, Math.min(1, (now.valueOf() - rise.valueOf()) / (set.valueOf() - rise.valueOf())));
  const status = left <= 0 ? 'The sun has set: come back tomorrow' : left < need ? `Only ${hrsText(left)} of daylight left: not enough for this one today` : `${hrsText(left)} of daylight left`;
  return `<h3>Today at the ${s.route ? 'trailhead' : 'site'}</h3>
    <div class="trp-sun">
      <div class="trp-arc"><svg viewBox="0 0 200 64" width="100%" height="64"><path d="M10,58 Q100,-26 190,58" class="sa-bg"/><path d="M10,58 Q100,-26 190,58" class="sa-fg" pathLength="1" style="stroke-dasharray:${frac} 1"/>${left > 0 && now > rise ? (() => { const t = frac, x = (1 - t) ** 2 * 10 + 2 * (1 - t) * t * 100 + t * t * 190, y = (1 - t) ** 2 * 58 + 2 * (1 - t) * t * -26 + t * t * 58; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" class="sa-sun"/>`; })() : ''}</svg>
        <span class="sa-l">☀ ${clockTime(rise)}</span><span class="sa-r">${clockTime(set)} ☾</span></div>
      <div class="trp-sun-t"><b>${status}</b><span>${dayH.toFixed(1)} h of daylight today${s.route ? ` · set off by <b>${clockTime(startBy)}</b> to finish before sunset (with 20% to spare)` : ''}</span></div>
    </div>`;
}

const POI_NEAR: Record<string, { ic: string; label: string }> = { viewpoint: { ic: '◎', label: 'Lookout' }, beach: { ic: '⛱', label: 'Beach' }, camp: { ic: '⛺', label: 'Camping' }, food: { ic: '☕', label: 'Food & coffee' }, lighthouse: { ic: '✦', label: 'Lighthouse' }, nature: { ic: '❦', label: 'Nature reserve' } };
function nearby(s: Subject) {
  const cx = s.route ? (() => { const b = boundsOf(s.route.parts.flat()); return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]; })() : [s.lon, s.lat];
  const dist = (lon: number, lat: number) => km(cx[0], cx[1], lon, lat);
  const self = s.guide?.id;
  const stops = GUIDE.filter((g) => g.id !== self).map((g) => ({ g, d: dist(g.lon, g.lat) })).filter((x) => x.d < 20).sort((a, b) => a.d - b.d).slice(0, 4);
  const pois = (D!.osm?.pois ?? []).filter((p) => POI_NEAR[p[2]] && (p[3] || p[2] !== 'viewpoint')).map((p) => ({ p, d: dist(p[0], p[1]) })).filter((x) => x.d < 6 && !(s.fall && x.p[2] === 'waterfall')).sort((a, b) => a.d - b.d);
  const seen = new Set<string>();
  const picks = pois.filter((x) => { const k = `${x.p[2]}:${x.p[3]}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  if (!stops.length && !picks.length) return '';
  return `<h3>Make a day of it</h3>
    ${stops.length ? `<div class="trp-near">${stops.map(({ g, d }) => `<button class="trp-chip" data-near-stop="${g.id}" style="--c:${GUIDE_KIND[g.kind].color}"><span>${KIND_IC[g.kind]}</span>${esc(g.name)}<small>${d < 1 ? '<1' : d.toFixed(0)} km</small></button>`).join('')}</div>` : ''}
    ${picks.length ? `<div class="trp-near">${picks.map(({ p, d }) => `<button class="trp-chip poi" data-near-lon="${p[0]}" data-near-lat="${p[1]}"><span>${POI_NEAR[p[2]].ic}</span>${esc(p[3] ?? POI_NEAR[p[2]].label)}<small>${POI_NEAR[p[2]].label.toLowerCase()} · ${d < 1 ? '<1' : d.toFixed(1)} km</small></button>`).join('')}</div>` : ''}`;
}

function ranks(r: TrailRoute) {
  const all = T!.routes, n = all.length;
  const pos = (f: (x: TrailRoute) => number) => [...all].sort((a, b) => f(b) - f(a)).indexOf(r) + 1;
  const ord = (k: number) => (k === 1 ? '' : k === 2 ? '2nd ' : k === 3 ? '3rd ' : `${k}th `);
  const a = pos((x) => x.km), b = pos((x) => x.up), c = pos((x) => x.hi);
  const lines = [`${ord(a)}longest`, `${ord(b)}most climbing`, `${ord(c)}highest`].map((t, i) => ({ t, k: [a, b, c][i] })).sort((x, y) => x.k - y.k);
  return `The ${lines[0].t} and ${lines[1].t} of the valley’s ${n} routes`;
}

// --- the report ---------------------------------------------------------------------------------

function renderReport(el: HTMLElement, v: View) {
  const s = subjectOf(v);
  if (!s) return renderOverview(el);
  const r = s.route, g = r ? geoOf(r, T!.falls) : null;
  const near = nearestPlace(s.lon, s.lat);
  const where = near ? (near.d < 1 ? `in ${near.p.name}` : `${near.d.toFixed(0)} km from ${near.p.name}`) : '';
  const score = effortScore(s);
  const label = r ? (gaugeLabel(score)) : s.effort ?? 'Easy';
  const mix = r ? terrainMix(r) : null;
  const wps = r ? waypoints(s) : [];
  const page = s.fall ? fallPage(s.fall) : r?.osm ? { url: osmPage(r.osm), label: 'OpenStreetMap' } : { url: `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=16/${s.lat}/${s.lon}`, label: 'OpenStreetMap' };
  const wiki = s.fall?.wiki ? wikiUrl(s.fall.wiki) : r?.wiki ? wikiUrl(r.wiki) : null;
  const web = safeUrl(r?.web);
  const tourable = s.guide && TOUR_ORDER.includes(s.guide.id);
  const access = s.fall ? (s.fall.path == null || s.fall.path > 2000 ? 'No mapped path within 2 km' : s.fall.path < 60 ? 'Right on a mapped trail' : `${fmt.int(s.fall.path)} m from a mapped path`) : null;

  el.innerHTML = `
    <div class="trp">
    <div class="trp-top">
      ${s.img ? `<a class="trp-hero" href="${commonsPage(s.img)}" target="_blank" rel="noopener"><img alt="${esc(s.name)}" src="${photo(s.img, 760)}"><span class="trp-cr">Photo: Wikimedia Commons ↗</span></a>` : satellite(s, 'trp-hero')}
      <div class="trp-title" style="--c:${s.color}">
        <div class="trp-k"><span>${s.kind === 'fall' ? '≋' : s.guide ? KIND_IC[s.guide.kind] : '▲'}</span>${esc(s.kindLabel)}${s.guide ? ' · in the guide' : ''}${where ? ` · ${esc(where)}` : ''}</div>
        <h2>${esc(s.name)}</h2>
      </div>
      <button class="trp-x" aria-label="Back to all hikes">×</button>
    </div>
    <div class="trp-acts">
      <button class="tr-fly trp-go"><span>${r ? '✈' : '⟳'}</span> ${r ? 'Fly it in 3D' : 'Orbit it in 3D'}</button>
      ${tourable ? '<button class="trp-sec" data-act="tour">▶ Tour from here</button>' : ''}
      <a class="trp-sec" target="_blank" rel="noopener" href="${directions(s.lon, s.lat)}">Directions ↗</a>
    </div>
    ${s.guide ? `<p class="lede">${esc(s.guide.note)}</p>` : r?.desc ? `<p class="lede">${esc(r.desc)}</p>` : ''}

    <div class="trp-effort">
      ${gauge(score, label, s.color)}
      <div class="trp-effort-t">
        ${r ? `<div class="trp-big"><b>${r.km}</b> km<span>·</span><b>${hrsText(r.hrs)}</b><span>·</span><b>↑${fmt.int(r.up)}</b> m</div><div class="trp-small">${ranks(r)}. ${r.loop ? 'A loop.' : r.parts.length > 1 ? `${r.parts.length} mapped loops and spurs, counted together.` : 'One way.'}</div>`
        : `<div class="trp-big"><b>${fmt.int(s.elev)}</b> m<span>·</span><b>${fmt.int(Math.max(0, s.elev - lakeLevel()))}</b> m above the lake</div><div class="trp-small">${access ? esc(access) + '. ' : ''}${s.fall?.h ? `A ${Math.round(s.fall.h)} m drop. ` : ''}${s.effort ? `${esc(s.effort)} to reach.` : ''}</div>`}
      </div>
    </div>

    ${r && mix ? `
    <h3>The climb</h3>
    <div class="tr-prof"></div>
    <div class="trp-mix"><i style="flex:${mix.flat};background:#bff5dc"></i><i style="flex:${mix.roll};background:#fcd34d"></i><i style="flex:${mix.steep};background:#fb7185"></i></div>
    <div class="trp-mix-l"><span><i style="background:#bff5dc"></i>${Math.round(mix.flat * 100)}% level</span><span><i style="background:#fcd34d"></i>${Math.round(mix.roll * 100)}% rolling</span><span><i style="background:#fb7185"></i>${Math.round(mix.steep * 100)}% steep</span></div>
    <p class="trp-small">Steepest stretch: <b>${Math.abs(mix.steepest * 100).toFixed(0)}% ${mix.steepest >= 0 ? 'up' : 'down'}</b> around km ${mix.steepAt.toFixed(1)}. Hover the profile to find any spot on the map.</p>

    <h3>Along the way</h3>
    <ol class="trp-way">${wps.map((w, k) => `<li data-wp="${k}" style="--c:${w.c}"><span class="trp-way-d">${w.d < 0.05 ? 'km 0' : `km ${w.d.toFixed(1)}`}</span><span class="trp-way-ic">${w.ic}</span><span class="trp-way-t"><b>${esc(w.t)}</b><small>${esc(w.sub)}</small></span></li>`).join('')}</ol>` : ''}

    ${r ? `<h3>From above</h3>${satellite(s, 'trp-card')}` : s.img ? `<h3>From above</h3>${satellite(s, 'trp-card')}` : ''}

    ${todayLight(s)}
    ${whenToGo(s)}
    ${nearby(s)}

    <div class="ld-actions">
      ${web ? `<a class="ld-btn" target="_blank" rel="noopener noreferrer" href="${esc(web)}">Website ↗</a>` : ''}
      ${wiki ? `<a class="ld-btn" target="_blank" rel="noopener" href="${esc(wiki)}">Wikipedia ↗</a>` : ''}
      <a class="ld-btn" target="_blank" rel="noopener" href="${esc(page.url)}">${page.label} ↗</a>
    </div>
    <p class="note">${r ? `Distances and climbing from the mapped line and ~25 m terrain tiles${r.parts.length > 1 ? '; gaps between mapped pieces are bridged for the profile' : ''}. Time is Naismith’s rule. ` : ''}Sun times are for today at this spot. Climate from ${esc(D!.normals?.stations?.[0]?.name ?? 'the nearest station')}’s monthly records (${D!.normals?.stations?.[0]?.period ?? ''}), down in the valley: it’s colder and snowier up high. Trails cross private, park and Crown land: follow posted rules${s.guide?.id === 'bebamikawe' ? ', and check with Wiikwemkoong Tourism before you go' : ''}.</p>
    </div>`;

  el.querySelector('.trp-x')!.addEventListener('click', () => go({ kind: 'overview' }, false));
  el.querySelector('.trp-go')!.addEventListener('click', () => (r ? startFlight(s.ri) : startOrbit({ lon: s.lon, lat: s.lat, name: s.name, sub: `${s.kindLabel} · ${fmt.int(s.elev)} m above sea level`, color: s.color })));
  el.querySelector('[data-act="tour"]')?.addEventListener('click', () => startTour(s.guide!.id));
  el.querySelectorAll<HTMLElement>('[data-near-stop]').forEach((b) => b.addEventListener('click', () => go(viewOfStop(guideOf(b.dataset.nearStop!)))));
  el.querySelectorAll<HTMLElement>('[data-near-lon]').forEach((b) => b.addEventListener('click', () => {
    host?.map.flyTo({ center: [+b.dataset.nearLon!, +b.dataset.nearLat!], zoom: Math.max(host.map.getZoom(), 14), pitch: 55, duration: 1500, essential: true });
  }));
  // the sat card and the gauge animate in once the panel is showing
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelector('.trp')?.classList.add('in')));
  if (r && g) {
    let chart: { setPlayhead: (d: number | null) => void } | null = null;
    requestAnimationFrame(() => { chart = profileChart(el.querySelector<HTMLElement>('.tr-prof')!, r, g, T!.falls, { height: 150, animate: true, marks: wps.filter((w) => w.ic !== '⚑' && w.ic !== '⚐').map((w) => ({ d: w.d, c: w.c, t: w.t })), onHover: (d) => { hoverD = d; } }); });
    el.querySelectorAll<HTMLElement>('[data-wp]').forEach((li) => {
      const w = wps[+li.dataset.wp!];
      li.addEventListener('mouseenter', () => { hoverD = w.d; chart?.setPlayhead(w.d); });
      li.addEventListener('mouseleave', () => { hoverD = null; chart?.setPlayhead(null); });
      li.addEventListener('click', () => host?.map.flyTo({ center: [w.lon, w.lat], zoom: 15.2, pitch: 60, duration: 1600, essential: true }));
    });
  }
}
const gaugeLabel = (s: number) => (s < 30 ? 'Easy' : s < 55 ? 'Moderate' : s < 75 ? 'Challenging' : 'Hard');

// ---------------------------------------------------------------------------------------------
// elevation profile (panel and flight HUD)

function profileChart(el: HTMLElement, r: TrailRoute, g: Geo, falls: Waterfall[], opts: { height: number; onHover?: (d: number | null) => void; compact?: boolean; animate?: boolean; marks?: { d: number; c: string; t: string }[] }) {
  const W = el.clientWidth || 340, H = opts.height;
  const m = { t: 14, r: 8, b: opts.compact ? 6 : 20, l: opts.compact ? 6 : 36 };
  const x = d3.scaleLinear().domain([0, g.total]).range([m.l, W - m.r]);
  const lo = Math.max(170, r.lo - 15), hi = Math.max(r.hi + 15, lo + 60);
  const y = d3.scaleLinear().domain([lo, hi]).range([H - m.b, m.t]).nice();
  const pts = r.prof.map((v, i) => [(i / (r.prof.length - 1)) * g.total, v] as [number, number]);
  const svg = d3.select(el).append('svg').attr('width', W).attr('height', H).attr('class', 'tr-prof-svg');
  const id = `trg${Math.random().toString(36).slice(2, 8)}`;
  const grad = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#e9fff6').attr('stop-opacity', 0.55);
  grad.append('stop').attr('offset', '45%').attr('stop-color', TRAIL_COLOR).attr('stop-opacity', 0.35);
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#0b4f6c').attr('stop-opacity', 0.05);
  const area = d3.area<[number, number]>().x((d) => x(d[0])).y0(H - m.b).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  const line = d3.line<[number, number]>().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX);
  if (!opts.compact) {
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickFormat((v) => `${v} km`) as any).call((s) => s.select('.domain').remove()).selectAll('text').attr('fill', '#7d8aa3').attr('font-size', 10).attr('dy', 10);
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat((v) => `${v}`) as any).call((s) => s.select('.domain').remove()).call((s) => s.selectAll('line').attr('stroke', 'rgba(148,170,210,.1)')).selectAll('text').attr('fill', '#7d8aa3').attr('font-size', 10);
  }
  // the profile draws itself in from the trailhead
  const clip = svg.select('defs').append('clipPath').attr('id', `${id}c`).append('rect').attr('x', 0).attr('y', 0).attr('height', H).attr('width', opts.animate ? m.l : W);
  if (opts.animate) clip.transition().duration(1400).ease(d3.easeCubicInOut).attr('width', W);
  const body = svg.append('g').attr('clip-path', `url(#${id}c)`);
  body.append('path').datum(pts).attr('d', area).attr('fill', `url(#${id})`);
  for (const mk of opts.marks ?? []) {
    body.append('line').attr('x1', x(mk.d)).attr('x2', x(mk.d)).attr('y1', y(elevAt(r, g, mk.d))).attr('y2', H - m.b).attr('stroke', mk.c).attr('stroke-opacity', 0.5).attr('stroke-dasharray', '2 3');
    body.append('circle').attr('cx', x(mk.d)).attr('cy', y(elevAt(r, g, mk.d))).attr('r', 3.5).attr('fill', mk.c).attr('stroke', '#06101a').attr('stroke-width', 1.2).append('title').text(mk.t);
  }
  // climbing sections get a warm edge, descents a cool one
  const stroke = body.append('g');
  for (let i = 1; i < pts.length; i++) {
    const grade = (pts[i][1] - pts[i - 1][1]) / Math.max(0.001, (pts[i][0] - pts[i - 1][0]) * 1000);
    const c = grade > 0.12 ? '#fb7185' : grade > 0.05 ? '#fcd34d' : grade < -0.08 ? '#7dd3fc' : '#bff5dc';
    stroke.append('path').datum([pts[i - 1], pts[i]]).attr('d', line as any).attr('stroke', c).attr('stroke-width', 2).attr('fill', 'none');
  }
  for (const fa of g.fallsAt) {
    svg.append('circle').attr('cx', x(fa.d)).attr('cy', y(elevAt(r, g, fa.d))).attr('r', 4).attr('fill', FALL_COLOR).attr('stroke', '#06101a').attr('stroke-width', 1.5).append('title').text(fallName(falls[fa.i]));
  }
  const top = r.prof.indexOf(r.hi);
  if (!opts.compact && top >= 0) svg.append('text').attr('x', Math.min(W - 30, Math.max(m.l + 24, x(pts[top][0])))).attr('y', y(r.hi) - 4).attr('text-anchor', 'middle').attr('fill', '#e9eef7').attr('font-size', 10).attr('font-weight', 600).text(`▲ ${fmt.int(r.hi)} m`);

  const head = svg.append('g').style('display', 'none');
  head.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', '#fff').attr('stroke-opacity', 0.6);
  head.append('circle').attr('r', 5).attr('fill', '#fff').attr('stroke', TRAIL_COLOR).attr('stroke-width', 2.5);
  const lab = head.append('text').attr('fill', '#fff').attr('font-size', 10.5).attr('font-weight', 600).attr('y', m.t - 3);
  const set = (d: number | null) => {
    if (d == null) { head.style('display', 'none'); return; }
    const e = elevAt(r, g, d);
    head.style('display', null).attr('transform', `translate(${x(d)},0)`);
    head.select('circle').attr('cy', y(e));
    if (!opts.compact) lab.text(`${d.toFixed(1)} km · ${Math.round(e)} m`).attr('text-anchor', x(d) > W - 90 ? 'end' : 'start').attr('dx', x(d) > W - 90 ? -6 : 6);
  };
  if (opts.onHover) {
    svg.on('pointermove', (ev: PointerEvent) => { const [px] = d3.pointer(ev); const d = Math.max(0, Math.min(g.total, x.invert(px))); set(d); opts.onHover!(d); })
      .on('pointerleave', () => { set(null); opts.onHover!(null); });
  }
  return { setPlayhead: set };
}

// ---------------------------------------------------------------------------------------------
// 3D: terrain, flights, orbits, the tour

let imageryTimer = 0;
function terrainOn(exaggeration = 1.25) {
  const m = host!.map;
  // mountain valley: the relief speaks for itself, so only a light exaggeration
  if (!m.getSource('dem-terrain'))
    m.addSource('dem-terrain', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', maxzoom: 13 } as any);
  m.setTerrain({ source: 'dem-terrain', exaggeration });
  clearTimeout(imageryTimer);
  if (!m.getSource('tr-imagery')) {
    m.addSource('tr-imagery', { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
    const before = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    m.addLayer({ id: 'tr-imagery', type: 'raster', source: 'tr-imagery', paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 1200 }, 'raster-brightness-max': 0.85, 'raster-saturation': 0.1, 'raster-contrast': 0.08 } as any }, before);
  }
  requestAnimationFrame(() => { if (m.getLayer('tr-imagery')) m.setPaintProperty('tr-imagery', 'raster-opacity', 1); });
}
function terrainOff() {
  const m = host!.map;
  try { m.setTerrain(null as any); } catch { /* already off */ }
  if (m.getLayer('tr-imagery')) m.setPaintProperty('tr-imagery', 'raster-opacity', 0);
  // drop the imagery once faded so it stops loading tiles and its credit leaves the map
  imageryTimer = window.setTimeout(() => {
    if (trailsCinema()) return;
    if (m.getLayer('tr-imagery')) m.removeLayer('tr-imagery');
    if (m.getSource('tr-imagery')) m.removeSource('tr-imagery');
  }, 1400);
}

/** Every route drawn with the map's own layers (deck.gl stands down over 3D terrain), the `hot` one bright. */
function routesOnMap(hot: number | null) {
  const m = host!.map;
  const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: T!.routes.flatMap((r, i) => r.parts.map((p) => ({ type: 'Feature' as const, properties: { hot: i === hot ? 1 : 0, c: LEVEL[r.level].c }, geometry: { type: 'LineString' as const, coordinates: p } }))) };
  const src = m.getSource('tr-routes') as maplibregl.GeoJSONSource | undefined;
  if (src) { src.setData(fc); return; }
  m.addSource('tr-routes', { type: 'geojson', data: fc });
  m.addLayer({ id: 'tr-routes-glow', type: 'line', source: 'tr-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'hot'], 1], '#ffffff', ['get', 'c']], 'line-width': ['case', ['==', ['get', 'hot'], 1], 16, 10], 'line-blur': 8, 'line-opacity': 0.5 } as any });
  m.addLayer({ id: 'tr-routes-line', type: 'line', source: 'tr-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['==', ['get', 'hot'], 1], '#ffffff', ['get', 'c']], 'line-width': ['case', ['==', ['get', 'hot'], 1], 4, 2.5] } as any });
}
function routesOffMap() {
  const m = host!.map;
  for (const id of ['tr-routes-line', 'tr-routes-glow']) if (m.getLayer(id)) m.removeLayer(id);
  if (m.getSource('tr-routes')) m.removeSource('tr-routes');
}

let flight: { stop: () => void } | null = null;
let orbit: { stop: () => void } | null = null;
let tour: { stop: () => void } | null = null;
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function setCinema(on: boolean) {
  document.body.classList.toggle('cinema', on);
  host?.setCinema(on);
}
function escKeys(handler: (e: KeyboardEvent) => void) {
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}

function startFlight(i: number) {
  if (!host || !T) return;
  stopAll();
  const m = host.map;
  const r = T.routes[i], g = geoOf(r, T.falls);
  terrainOn();
  setCinema(true);

  const geo: GeoJSON.Feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.line } };
  m.addSource('fly-route', { type: 'geojson', data: geo, lineMetrics: true } as any);
  m.addLayer({ id: 'fly-route-glow', type: 'line', source: 'fly-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': TRAIL_COLOR, 'line-width': 16, 'line-blur': 10, 'line-opacity': 0.6 } });
  m.addLayer({ id: 'fly-route-line', type: 'line', source: 'fly-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 4.5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#ffffff', 1, TRAIL_COLOR] } as any });
  const pins = g.fallsAt.map(({ i: fi }) => pinMarker(T!.falls[fi].lon, T!.falls[fi].lat, fallName(T!.falls[fi]), null, FALL_COLOR));

  const dot = document.createElement('div');
  dot.className = 'tr-hiker';
  const marker = new maplibregl.Marker({ element: dot }).setLngLat(r.line[0]).addTo(m);

  const hud = document.createElement('div');
  hud.className = 'tr-hud glass';
  hud.innerHTML = `
    <div class="th-top"><div><div class="th-k" style="color:${LEVEL[r.level].c}">Flying the trail · ${LEVEL[r.level].name}</div><div class="th-nm">${esc(r.name)}</div></div>
      <div class="th-ctl"><button class="th-play" aria-label="Pause">❚❚</button>${[1, 2, 4].map((s) => `<button class="th-sp${s === 1 ? ' on' : ''}" data-s="${s}">${s}×</button>`).join('')}<button class="th-x" aria-label="Stop flight">✕</button></div></div>
    <div class="th-stats"><div><b class="th-km">0.0</b><span>km of ${g.total.toFixed(1)}</span></div><div><b class="th-el">–</b><span>m elevation</span></div><div><b class="th-up">0</b><span>m climbed</span></div><div><b class="th-t">0:00</b><span>walking time</span></div></div>
    <div class="th-prof"></div>
    <div class="th-hint">Drag to look around · Space pause · Esc exit</div>`;
  document.body.appendChild(hud);
  const chart = profileChart(hud.querySelector<HTMLElement>('.th-prof')!, r, g, T.falls, { height: 64, compact: true });

  // ~25 s for a short walk, longer routes a little longer
  const duration = Math.min(75, 22 + g.total * 3);
  let speed = 1, paused = false, d = 0, last = performance.now(), raf = 0, done = false;
  let bearing = bearingOf(r.line[0], along(r, g, Math.min(g.total, 0.3)));
  let climbed = 0, lastE = elevAt(r, g, 0);
  const zoom = g.total > 10 ? 14.2 : 14.8;
  const look = Math.max(0.15, g.total / 30);
  const fmtT = (h: number) => { const mm = Math.round(h * 60); return `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}`; };
  let userTilt = 0;
  const onDrag = () => { userTilt = performance.now(); };
  m.on('dragstart', onDrag);
  const q = <T extends HTMLElement>(s: string) => hud.querySelector(s) as T;

  const step = (now: number) => {
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!paused && !done) {
      d = Math.min(g.total, d + (g.total / duration) * dt * speed);
      const pos = along(r, g, d);
      const ahead = along(r, g, Math.min(g.total, d + look));
      if (d < g.total - 0.01) bearing = lerpAngle(bearing, bearingOf(pos, ahead), Math.min(1, dt * 1.3));
      marker.setLngLat(pos);
      if (now - userTilt > 2500) m.jumpTo({ center: pos, bearing, pitch: 66, zoom });
      else m.jumpTo({ center: pos });
      const e = elevAt(r, g, d);
      if (e > lastE) climbed += e - lastE;
      lastE = e;
      chart.setPlayhead(d);
      q('.th-km').textContent = d.toFixed(1);
      q('.th-el').textContent = fmt.int(e);
      q('.th-up').textContent = fmt.int(Math.min(climbed, r.up * 1.15));
      q('.th-t').textContent = fmtT((d / Math.max(0.1, g.total)) * r.hrs);
      m.setPaintProperty('fly-route-line', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, '#ffffff', Math.max(0.0001, Math.min(0.9998, d / g.total)), '#ffffff', Math.min(0.9999, d / g.total + 0.0001), TRAIL_COLOR, 1, TRAIL_COLOR] as any);
      if (d >= g.total) {
        done = true;
        hud.classList.add('done');
        q('.th-play').textContent = '↻';
        m.fitBounds(boundsOf(r.line), { padding: 120, pitch: 60, bearing: bearing - 30, duration: 3500, essential: true });
      }
    }
    raf = requestAnimationFrame(step);
  };

  const playBtn = q<HTMLButtonElement>('.th-play');
  const setPaused = (p: boolean) => { paused = p; playBtn.textContent = p ? '▶' : '❚❚'; playBtn.setAttribute('aria-label', p ? 'Play' : 'Pause'); };
  playBtn.addEventListener('click', () => {
    if (done) { done = false; d = 0; climbed = 0; lastE = elevAt(r, g, 0); hud.classList.remove('done'); setPaused(false); m.flyTo({ center: r.line[0], zoom, pitch: 66, bearing, duration: 1500 }); return; }
    setPaused(!paused);
  });
  hud.querySelectorAll<HTMLButtonElement>('.th-sp').forEach((b) => b.addEventListener('click', () => { speed = +b.dataset.s!; hud.querySelectorAll('.th-sp').forEach((x) => x.classList.toggle('on', x === b)); }));
  q('.th-x').addEventListener('click', () => stopAll());
  const unkey = escKeys((e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopAll(); }
    else if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); setPaused(!paused); }
    else if (/^(l|L|p|P|s|S|ArrowLeft|ArrowRight)$/.test(e.key)) e.stopImmediatePropagation();
  });

  // swoop in to the trailhead, then go
  m.flyTo({ center: r.line[0], zoom, pitch: 66, bearing, duration: calm() ? 0 : 3400, essential: true });
  m.once('moveend', () => { last = performance.now(); raf = requestAnimationFrame(step); });

  flight = {
    stop() {
      cancelAnimationFrame(raf);
      unkey();
      m.off('dragstart', onDrag);
      marker.remove();
      pins.forEach((p) => p.remove());
      hud.remove();
      for (const id of ['fly-route-line', 'fly-route-glow']) if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource('fly-route')) m.removeSource('fly-route');
      flight = null;
      terrainOff();
      setCinema(false);
      m.fitBounds(boundsOf(r.parts.flat()), { padding: panelPad(), pitch: 50, duration: 1600, maxZoom: 14, essential: true });
    },
  };
}

/** A label card and ripples pinned to a spot on the 3D terrain. */
function pinMarker(lon: number, lat: number, name: string, sub: string | null, color: string) {
  const el = document.createElement('div');
  el.className = 'tr-fallpin';
  el.style.setProperty('--c', color);
  el.innerHTML = `<i></i><i></i><i></i><div class="tr-fallpin-card"><b>${esc(name)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lon, lat]).addTo(host!.map);
}

function startOrbit(o: { lon: number; lat: number; name: string; sub: string; color: string }) {
  if (!host) return;
  stopAll();
  const m = host.map;
  terrainOn();
  routesOnMap(null);
  setCinema(true);
  const mk = pinMarker(o.lon, o.lat, o.name, o.sub, o.color);
  let raf = 0, last = 0, spinning = false;
  const spin = (now: number) => {
    if (last) m.setBearing(m.getBearing() + ((now - last) / 1000) * 7);
    last = now;
    raf = requestAnimationFrame(spin);
  };
  m.flyTo({ center: [o.lon, o.lat], zoom: 14.6, pitch: 70, bearing: m.getBearing() - 40, duration: calm() ? 0 : 4200, essential: true });
  m.once('moveend', () => { if (!calm() && orbit) { spinning = true; raf = requestAnimationFrame(spin); } });
  const halt = () => { if (spinning) { cancelAnimationFrame(raf); spinning = false; } };
  m.on('mousedown', halt); m.on('touchstart', halt); m.on('wheel', halt);
  const bar = document.createElement('div');
  bar.className = 'tr-orbit-bar glass';
  bar.innerHTML = `<span>⟳ Orbiting <b>${esc(o.name)}</b> in 3D · drag to look around</span><button>Back to the map</button>`;
  document.body.appendChild(bar);
  bar.querySelector('button')!.addEventListener('click', () => stopAll());
  const unkey = escKeys((e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopAll(); } });
  orbit = {
    stop() {
      halt(); unkey();
      m.off('mousedown', halt); m.off('touchstart', halt); m.off('wheel', halt);
      mk.remove(); bar.remove();
      orbit = null;
      routesOffMap();
      terrainOff();
      setCinema(false);
      m.easeTo({ pitch: 55, zoom: 12, duration: 1400 });
    },
  };
}

/** The guide as a road trip: fly to each stop over 3D terrain, its card and photo alongside. */
export function startTour(fromId?: string) {
  if (!host || !T) return;
  stopAll();
  const m = host.map;
  const stops = TOUR_ORDER.map((id) => GUIDE.find((g) => g.id === id)).filter((g): g is GuideStop => !!g);
  for (const g of GUIDE) if (!stops.includes(g)) stops.push(g);
  terrainOn();
  routesOnMap(null);
  setCinema(true);
  const card = document.createElement('div');
  card.className = 'tr-tour';
  document.body.appendChild(card);
  let k = -1, raf = 0, timer = 0, mk: maplibregl.Marker | null = null, token = 0, paused = false;
  const cancelSpin = () => cancelAnimationFrame(raf);
  stops.forEach((g) => { const img = extraOf(g).img; if (img) { const im = new Image(); im.src = photo(img, 760); } });

  const show = (n: number) => {
    k = (n + stops.length) % stops.length;
    const g = stops[k], x = extraOf(g), my = ++token, c = GUIDE_KIND[g.kind].color;
    const r = x.route >= 0 ? T!.routes[x.route] : null;
    cancelSpin(); clearTimeout(timer); mk?.remove();
    routesOnMap(x.route >= 0 ? x.route : null);
    card.style.setProperty('--c', c);
    card.innerHTML = `
      <div class="tt-img">${x.img ? `<img alt="" src="${photo(x.img, 760)}">` : `<div class="tt-none"><span>${KIND_IC[g.kind]}</span><div class="tr-hero-fx"></div></div>`}</div>
      <div class="tt-body">
        <div class="tt-k">Stop ${k + 1} of ${stops.length} · ${GUIDE_KIND[g.kind].label}</div>
        <div class="tt-nm">${esc(g.name)}</div>
        <div class="tt-st">${r ? `<span><b>${r.km} km</b></span><span><b>↑${fmt.int(r.up)} m</b> climbing</span><span><b>${hrsText(r.hrs)}</b></span>` : ''}<span><b>${fmt.int(x.elev)} m</b> above the sea</span><span>${esc(g.effort)}</span></div>
        <p class="tt-note">${esc(g.note)}</p>
        <div class="tt-dots">${stops.map((_, j) => `<i class="${j === k ? 'on' : ''}"></i>`).join('')}</div>
        <div class="tt-ctl"><button data-a="prev" aria-label="Previous">‹</button><button data-a="pause" aria-label="${paused ? 'Play' : 'Pause'}">${paused ? '▶' : '❚❚'}</button><button data-a="next" aria-label="Next">›</button>${r ? '<button data-a="fly">✈ Fly it</button>' : ''}<button data-a="open">Details</button><button data-a="x" aria-label="End tour">✕</button></div>
        ${x.img ? '<div class="tt-cr">Photo: Wikimedia Commons</div>' : ''}
      </div>`;
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
    card.querySelector('[data-a="prev"]')!.addEventListener('click', () => show(k - 1));
    card.querySelector('[data-a="next"]')!.addEventListener('click', () => show(k + 1));
    card.querySelector('[data-a="pause"]')!.addEventListener('click', (e) => { paused = !paused; (e.currentTarget as HTMLElement).textContent = paused ? '▶' : '❚❚'; if (!paused) timer = window.setTimeout(() => show(k + 1), 4000); else clearTimeout(timer); });
    card.querySelector('[data-a="fly"]')?.addEventListener('click', () => { const ri = x.route; view = { kind: 'route', i: ri }; if (panelEl) renderPanel(panelEl); startFlight(ri); });
    card.querySelector('[data-a="open"]')!.addEventListener('click', () => { stopAll(); go(viewOfStop(g)); });
    card.querySelector('[data-a="x"]')!.addEventListener('click', () => stopAll());
    mk = pinMarker(g.lon, g.lat, g.name, null, c);
    const target = r ? (() => { const b = boundsOf(r.parts.flat()); return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] as [number, number]; })() : ([g.lon, g.lat] as [number, number]);
    const span = r ? Math.max(...(([a, b]) => [(b[0] - a[0]) * kx, (b[1] - a[1]) * ky])(boundsOf(r.parts.flat()))) : 0;
    const zoom = r ? Math.max(12.6, Math.min(14.8, 14.8 - Math.log2(Math.max(1, span / 1.2)))) : 14.6;
    m.flyTo({ center: target, zoom, pitch: 68, bearing: (k * 67) % 360 - 180, duration: calm() ? 0 : 5400, curve: 1.6, essential: true });
    m.once('moveend', () => {
      if (my !== token || !tour) return;
      let last = 0;
      const spin = (now: number) => { if (last) m.setBearing(m.getBearing() + ((now - last) / 1000) * 8); last = now; raf = requestAnimationFrame(spin); };
      if (!calm()) raf = requestAnimationFrame(spin);
      if (!paused) timer = window.setTimeout(() => show(k + 1), 7000);
    });
  };
  const unkey = escKeys((e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stopAll(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); show(k + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); show(k - 1); }
    else if (e.code === 'Space' || /^(l|L|p|P|s|S)$/.test(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  });
  tour = {
    stop() {
      token++; cancelSpin(); clearTimeout(timer); unkey(); mk?.remove(); card.remove();
      tour = null;
      routesOffMap();
      terrainOff();
      setCinema(false);
    },
  };
  show(Math.max(0, stops.findIndex((g) => g.id === fromId)));
}

export function stopAll() {
  flight?.stop();
  orbit?.stop();
  tour?.stop();
}

// ---------------------------------------------------------------------------------------------
// shared with the Place Report

/** The routes and waterfalls near a place, as HTML for its report card (buttons carry data-hike-route / data-hike-fall). */
export function placeTrailsHTML(data: Data, key: string) {
  const t = data.trails?.places?.[key];
  if (!t || !data.trails) return '';
  const rs = t.routes.filter(([, d]) => d <= 15).slice(0, 5);
  // a waterfall whose guide route is already listed (Bridal Veil) isn't listed twice
  const fs = t.falls.filter(([i, d]) => d <= 20 && !rs.some(([ri]) => data.trails!.routes[ri].name === data.trails!.falls[i].name)).slice(0, 3);
  if (!rs.length && !fs.length) return `<p class="note">${t.km10} km of mapped footpath within 10 km; no guide route within 15 km.</p>`;
  return `<div class="tr-falls pr-trails">${rs.map(([i, d]) => { const r = data.trails!.routes[i]; return `<button class="tr-fall tr-rt" data-hike-route="${i}" style="--c:${LEVEL[r.level].c}"><span class="tr-lv"></span>${esc(r.name)} <small>${d < 0.5 ? 'here' : `${d.toFixed(0)} km`} · ${r.km} km</small></button>`; }).join('')}${fs.map(([i, d]) => `<button class="tr-fall" data-hike-fall="${i}"><span class="tr-drop"></span>${esc(fallName(data.trails!.falls[i]))} <small>${d.toFixed(0)} km</small></button>`).join('')}</div><p class="note">${t.km10} km of mapped footpath within 10 km. Click one to open it on the map.</p>`;
}

export { LEVEL, hrsText };
