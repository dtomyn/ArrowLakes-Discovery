// Each "atlas layer" bundles: deck.gl layers for a moment in time, a timeline sparkline,
// notable events, a story panel, and map tooltips.
import * as d3 from 'd3';
import { ColumnLayer, LineLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { DataFilterExtension, PathStyleExtension } from '@deck.gl/extensions';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { Data, Fire, MONTHS, Place, Poi, Quake, Trail, Trip, coastRings, fmt, interpMonthly, interpYearly, keyToT, km, lowerBound, monthKey } from './data';
import { barChart, lineChart, rampCSS, scatterChart, stripes, ChartHandle } from './charts';
import { placeMetrics } from './metrics';
import { esc } from './html';
import { hikeViewAt, hikesLayer, openHikeView } from './trails';

/** `hovered` is the place key under the pointer (place pin or column), if any. */
export type Ctx = { time: number; speed: number; data: Data; selected: string | null; hovered: string | null; focusedId: string; clock: number };
export type AtlasEvent = { t: number; layer: string; title: string; body: string; lon?: number; lat?: number; zoom?: number };
export type PanelHandle = { update: (ctx: Ctx) => void };

export interface AtlasLayer {
  id: string;
  name: string;
  icon: string;
  color: string;
  range: [number, number];
  monthly?: boolean;
  /** Doesn't change over time: focusing it dims the timeline, which keeps the last time layer's range. */
  static?: boolean;
  /** Menu caption for a static layer instead of the year range. */
  period?: string;
  available: boolean;
  unavailable?: string;
  build: (ctx: Ctx) => Layer[];
  spark: () => { x: number; y: number; color?: string }[];
  events: () => AtlasEvent[];
  panel: (el: HTMLElement, ctx: Ctx) => PanelHandle;
  tooltip: (info: PickingInfo) => string | null;
  click?: (info: PickingInfo) => boolean;
}

// ---------------------------------------------------------------------------------------------
// shared bits

type RGBA = [number, number, number, number];
const rgb = (c: string, a = 255): RGBA => {
  const o = d3.rgb(c);
  return [o.r, o.g, o.b, a];
};
const ADDITIVE = { blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one', blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha', depthWriteEnabled: false } as const;
const NO_DEPTH = { depthWriteEnabled: false, depthCompare: 'always' } as const;
const filterExt = [new DataFilterExtension({ filterSize: 1 })];
const dashExt = [new PathStyleExtension({ dash: true })];
const NOW = new Date().getFullYear();

/** How long (in timeline years) a "new" event keeps glowing; tied to playback speed. */
const glowWindow = (speed: number, k = 1) => Math.max(0.25, speed * 0.9 * k);

const kicker = (l: AtlasLayer, text: string) => `<div class="kicker" style="--c:${l.color}">${text}</div>`;
const sourceLine = (s: string) => `<div class="source">Source: ${esc(s)}</div>`;
const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const unavailableBox = (el: HTMLElement, l: AtlasLayer) => {
  el.insertAdjacentHTML('beforeend', `<div class="unavail">${l.unavailable ?? 'This data could not be loaded.'}</div>`);
  return { update() {} };
};

function heroStats(el: HTMLElement, n: number) {
  const wrap = mk('div', 'hero');
  const cells = Array.from({ length: n }, () => {
    const s = mk('div', 'stat', '<div class="v">–</div><div class="l"></div>');
    wrap.appendChild(s);
    return { v: s.querySelector('.v') as HTMLElement, l: s.querySelector('.l') as HTMLElement };
  });
  el.appendChild(wrap);
  return (i: number, v: string, l: string) => {
    if (cells[i].v.textContent !== v) cells[i].v.textContent = v;
    if (cells[i].l.textContent !== l) cells[i].l.textContent = l;
  };
}

/** Builds charts after the panel is in the DOM (they need a measured width). */
function deferChart(el: HTMLElement, make: (el: HTMLElement) => ChartHandle) {
  let h: ChartHandle | null = null;
  requestAnimationFrame(() => (h = make(el)));
  return (t: number) => h?.setPlayhead(t);
}

const label = (id: string, data: any[], pos: (d: any) => [number, number, number?], text: (d: any) => string, opts: Record<string, unknown> = {}) =>
  new TextLayer<any>({
    id, data, getPosition: pos as any, getText: text,
    getSize: 12, getColor: [235, 240, 248, 235], fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto',
    outlineWidth: 3, outlineColor: [6, 10, 18, 220], fontSettings: { sdf: true }, billboard: true,
    getAlignmentBaseline: 'bottom', parameters: NO_DEPTH, ...opts,
  } as any);

/** Columns at a set of places: `value` null hides a place. Objects are { p, v } so clicks open the report. */
function placeColumns(id: string, places: Place[], value: (p: Place) => number | null, height: (v: number) => number, colorOf: (v: number, p: Place) => RGBA, trigger: unknown, radius = 1300) {
  const live = places.map((p) => ({ p, v: value(p) })).filter((d) => d.v != null) as { p: Place; v: number }[];
  return new ColumnLayer<any>({
    id: `${id}-cols`,
    data: live,
    getPosition: (d) => [d.p.lon, d.p.lat],
    radius,
    diskResolution: 28,
    extruded: true,
    getElevation: (d) => height(d.v),
    getFillColor: (d) => colorOf(d.v, d.p),
    material: { ambient: 0.55, diffuse: 0.65, shininess: 60 },
    pickable: true,
    transitions: { getElevation: { duration: 600, easing: d3.easeCubicOut }, getFillColor: 600 },
    updateTriggers: { getElevation: trigger, getFillColor: trigger },
  });
}

// ---------------------------------------------------------------------------------------------
// ARROW LAKES RESERVOIR LEVELS — the lake surface rises and falls in its valley, month by month

function waterLayer(data: Data): AtlasLayer {
  const color = '#4cc9f0';
  const W = data.water;
  const stations = W?.stations ?? [];
  const resv = stations.filter((s) => s.lake === 'reservoir').sort((a, b) => Object.keys(b.months).length - Object.keys(a.months).length);
  const natural = stations.filter((s) => s.lake === 'natural').sort((a, b) => Object.keys(b.months).length - Object.keys(a.months).length);
  // one reservoir series: the longest gauge (Nakusp), gaps filled from the other, offset by their mean difference
  const lake: Record<string, number> = { ...(resv[0]?.months ?? {}) };
  if (resv[1]) {
    const both = Object.keys(resv[0].months).filter((k) => resv[1].months[k] != null);
    const off = d3.mean(both, (k) => resv[0].months[k] - resv[1].months[k]) ?? 0;
    for (const [k, v] of Object.entries(resv[1].months)) if (lake[k] == null) lake[k] = v + off;
  }
  const keys = Object.keys(lake).sort();
  const hiK = keys.reduce((a, b) => (lake[b] > lake[a] ? b : a), keys[0]);
  const loK = keys.reduce((a, b) => (lake[b] < lake[a] ? b : a), keys[0]);
  const lo = lake[loK] ?? 0, hi = lake[hiK] ?? 1;
  const stMin = Object.fromEntries(stations.map((s) => [s.id, d3.min(Object.values(s.months)) ?? 0]));
  const stMax = Object.fromEntries(stations.map((s) => [s.id, d3.max(Object.values(s.months)) ?? 0]));
  // colour by drawdown: metres below the highest month on record (full → blue, drawn down → mud gold)
  const fill = d3.scaleLinear<string>().domain([0, 4, 10, 16, 21]).range(['#6f8bff', '#4cc9f0', '#7fd6c2', '#d8c48c', '#f2b05e']).clamp(true);
  const natCol = '#8fdcff';
  const EXAG = 150;
  const zOf = (lvl: number) => 300 + (lvl - lo) * EXAG;
  const rings = coastRings(data.base);
  // every nth shore vertex gets a faint vertical "curtain" from the ground up to the water line
  const curtain = rings.flatMap((r) => r.filter((_, i) => i % 5 === 0));
  const natKeys = natural.flatMap((s) => Object.keys(s.months)).sort();
  const t0 = natKeys.length ? keyToT(natKeys[0]) : keys.length ? keyToT(keys[0]) : 1969;
  const tDam = keys.length ? keyToT(keys[0]) : 1969;
  const t1 = keys.length ? keyToT(keys.at(-1)!) + 1 / 12 - 0.001 : NOW;
  const levelAt = (t: number) => interpMonthly(lake, t);
  // yearly range (max − min) for every complete year at each gauge: independent of the gauge's datum
  const yearRange = (months: Record<string, number>) => {
    const by: Record<number, number[]> = {};
    for (const [k, v] of Object.entries(months)) (by[+k.slice(0, 4)] ??= []).push(v);
    return Object.entries(by).filter(([, vs]) => vs.length === 12).map(([y, vs]) => ({ y: +y, r: d3.max(vs)! - d3.min(vs)!, max: d3.max(vs)!, min: d3.min(vs)! }));
  };
  const resvYears = yearRange(lake);
  const natYears = natural[0] ? yearRange(natural[0].months) : [];
  const avgResv = d3.mean(resvYears, (d) => d.r) ?? 0, avgNat = d3.mean(natYears, (d) => d.r) ?? 0;
  // the average shape of a year: mean level by calendar month
  const byMonth = d3.range(12).map((m) => d3.mean(keys.filter((k) => +k.slice(5, 7) === m + 1), (k) => lake[k]) ?? 0);
  const lowM = byMonth.indexOf(d3.min(byMonth)!), highM = byMonth.indexOf(d3.max(byMonth)!);
  const poorFill = [...resvYears].sort((a, b) => a.max - b.max)[0];

  const l: AtlasLayer = {
    id: 'water',
    name: 'Reservoir levels',
    icon: '🌊',
    color,
    range: [t0, t1],
    monthly: true,
    available: !!W && keys.length > 0,
    unavailable: 'The Environment Canada water-level archive could not be downloaded when this copy of the data was built. Run <code>npm run data water</code>, then reload.',
    build({ time, clock, focusedId }) {
      const out: Layer[] = [];
      const lvl = time >= tDam ? levelAt(time) : null;
      const shimmer = 0.75 + 0.25 * Math.sin(clock / 700);
      if (lvl != null) {
        const col = fill(hi - lvl);
        const zr = Math.round(zOf(lvl) / 10) * 10;
        out.push(
          new PolygonLayer<any>({
            id: 'water-plane',
            data: rings.map((r) => ({ polygon: r.map(([x, y]) => [x, y, zr]) })),
            getPolygon: (d) => d.polygon,
            filled: true,
            stroked: false,
            getFillColor: rgb(col, 70),
            updateTriggers: { getPolygon: zr, getFillColor: col },
            parameters: NO_DEPTH,
          }),
          new LineLayer<[number, number]>({
            id: 'water-curtain',
            data: curtain,
            getSourcePosition: (p) => [p[0], p[1], 0],
            getTargetPosition: (p) => [p[0], p[1], zr],
            getColor: rgb(col, 60),
            getWidth: 1,
            updateTriggers: { getTargetPosition: zr, getColor: col },
            parameters: ADDITIVE,
          }),
          new PathLayer<[number, number][]>({
            id: 'water-line-glow',
            data: rings,
            getPath: (r) => r.map(([x, y]) => [x, y, zr]) as any,
            getColor: rgb(col, 90 * shimmer),
            getWidth: 9,
            widthUnits: 'pixels',
            updateTriggers: { getPath: zr, getColor: [col, shimmer] },
            parameters: ADDITIVE,
          }),
          new PathLayer<[number, number][]>({
            id: 'water-line',
            data: rings,
            getPath: (r) => r.map(([x, y]) => [x, y, zr]) as any,
            getColor: rgb(d3.color(col)!.brighter(0.8).formatHex(), 230),
            getWidth: 1.6,
            widthUnits: 'pixels',
            updateTriggers: { getPath: zr, getColor: col },
            parameters: NO_DEPTH,
          }),
          // the full-pool line: where the water stood in the highest month on record
          new PathLayer<[number, number][]>({
            id: 'water-fullpool',
            data: rings,
            getPath: (r) => r.map(([x, y]) => [x, y, zOf(hi)]) as any,
            getColor: rgb('#6f8bff', 70),
            getWidth: 1,
            widthUnits: 'pixels',
            extensions: dashExt,
            getDashArray: [6, 6],
            parameters: NO_DEPTH,
          } as any),
        );
      }
      const live = stations
        .filter((s) => (s.lake === 'reservoir') === (time >= tDam))
        .map((s) => ({ s, v: interpMonthly(s.months, time) }))
        .filter((d) => d.v != null) as { s: (typeof stations)[number]; v: number }[];
      const colH = (d: { s: (typeof stations)[number]; v: number }) => (d.s.lake === 'reservoir' ? zOf(d.v) : 300 + (d.v - stMin[d.s.id]) * EXAG);
      out.push(
        new ColumnLayer<any>({
          id: 'water-gauges',
          data: live,
          getPosition: (d) => [d.s.lon, d.s.lat],
          radius: 1100,
          diskResolution: 24,
          extruded: true,
          getElevation: colH,
          getFillColor: (d) => (d.s.lake === 'reservoir' ? rgb(fill(hi - d.v), 235) : rgb(natCol, 220)),
          material: { ambient: 0.6, diffuse: 0.6 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
        }),
      );
      if (focusedId === 'water')
        out.push(label('water-gauge-labels', live, (d) => [d.s.lon, d.s.lat, colH(d) + 700], (d) => (d.s.lake === 'reservoir' ? `${d.v.toFixed(1)} m` : `+${(d.v - stMin[d.s.id]).toFixed(1)} m`), { fontFamily: 'JetBrains Mono, monospace', updateTriggers: { getText: time, getPosition: time } }));
      return out;
    },
    spark: () => [
      ...(natural[0] ? Object.entries(natural[0].months).filter(([k]) => keyToT(k) < tDam).map(([k, v]) => ({ x: keyToT(k), y: v - stMin[natural[0].id], color: natCol })) : []),
      ...keys.map((k) => ({ x: keyToT(k), y: lake[k] - lo, color: fill(hi - lake[k]) })),
    ],
    events() {
      if (!keys.length) return [];
      const ev = (t: number, title: string, body: string): AtlasEvent => ({ t: t + 0.04, layer: 'water', title, body, lon: -117.85, lat: 50.05, zoom: 7.9 });
      const out = [
        ev(keyToT(hiK), `${fmt.month(keyToT(hiK))}: the reservoir at its highest`, `The monthly mean at Nakusp reached ${hi.toFixed(2)} m above sea level, the highest in the ${keys[0].slice(0, 4)}–${keys.at(-1)!.slice(0, 4)} record.`),
        ev(keyToT(loK), `${fmt.month(keyToT(loK))}: the reservoir at its lowest`, `The water fell to ${lo.toFixed(2)} m, ${(hi - lo).toFixed(1)} m below the record high. At low water, kilometres of old riverbed, stumps and drowned townsite foundations appear.`),
      ];
      if (poorFill && Math.abs(poorFill.y + 0.55 - keyToT(hiK)) > 2)
        out.push(ev(poorFill.y + 0.55, `${poorFill.y}: the summer it didn’t fill`, `The reservoir peaked at just ${poorFill.max.toFixed(1)} m that year, ${(hi - poorFill.max).toFixed(1)} m short of its record: the lowest summer high since the dam.`));
      return out;
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `Arrow Lakes water levels · ${Math.floor(t0)} → ${keys.at(-1)?.slice(0, 4) ?? ''}`)}
        <h2>The lake that rises and falls</h2>`;
      if (!l.available) return unavailableBox(el, l);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Since the Hugh Keenleyside Dam closed in 1968, the two Arrow Lakes have been one reservoir, drawn down over winter and refilled by snowmelt. The glowing surface is the lake raised and lowered with each month’s level at Nakusp (exaggerated ${EXAG}×; the dashed line is the record high). <b>Blue</b> means full; <b>gold</b> means drawn down, with mudflats along the shore. Before 1969 the columns are gauges on the natural lakes.</p>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Monthly level at Nakusp (m above sea level)</h3>`);
      const series = resv.map((s, i) => ({ key: s.id, label: s.name.replace(/ At /, ' at '), color: ['#4cc9f0', '#a99bff'][i % 2], width: i === 0 ? 1.6 : 1.1, muted: i > 0, values: Object.entries(s.months).map(([k, v]) => ({ x: keyToT(k), y: v })) }));
      const setA = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [tDam, t1], height: 150, yFormat: (v) => `${Math.round(v)}`, valueFormat: (v) => `${v.toFixed(2)} m`, yZero: false }));
      el.insertAdjacentHTML('beforeend', `<h3>How far the lake swings each year (m)</h3>`);
      const bars = [...natYears.map((d) => ({ x: d.y, y: d.r, color: natCol })), ...resvYears.map((d) => ({ x: d.y, y: d.r, color: fill(d.r) }))];
      const setB = deferChart(el.appendChild(mk('div')), (c) => barChart(c, { data: bars, xDomain: [Math.floor(t0), Math.floor(t1)], color, height: 120, yFormat: (v) => `${v}`, tooltip: (d) => `<b>${d.x}</b><br>${d.y.toFixed(1)} m from lowest to highest month${d.x < tDam ? ' (natural lake)' : ''}` }));
      el.insertAdjacentHTML('beforeend', `
        <div class="legend"><span><i class="sw" style="background:${natCol}"></i>natural lake (${esc(natural[0]?.name ?? 'pre-dam gauge')})</span><span><i class="sw" style="background:${color}"></i>reservoir</span></div>
        <div class="ramp" style="background:${rampCSS((t) => fill(t * 21))}"></div>
        <div class="ramp-labels"><span>full</span><span>10 m down</span><span>20 m down</span></div>
        <div class="callout" style="--c:${color}">Before the dam, the lake at Nakusp rose and fell about <b>${avgNat.toFixed(1)} m</b> a year with the snowmelt. As a reservoir it swings about <b>${avgResv.toFixed(1)} m</b>, and up to <b>${(d3.max(resvYears, (d) => d.r) ?? 0).toFixed(1)} m</b>. On average it is lowest in <b>${MONTHS[lowM]}</b> and fullest in <b>${MONTHS[highM]}</b>. For a waterfront lot, ask where the water sits in spring as well as in summer.</div>
        <p class="note">Reservoir gauges (Nakusp, Fauquier) read metres above sea level. The pre-dam gauges read against their own local datums, so they’re compared by their yearly swing, not their height. The lake is run by BC Hydro under the Columbia River Treaty; monthly means come from Environment Canada’s HYDAT archive, which runs a year or two behind today.</p>
        ${sourceLine(W!.source)}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          if (time < tDam) {
            const nat = natural.map((s) => ({ s, v: interpMonthly(s.months, time) })).find((d) => d.v != null);
            hero(0, nat ? `+${(nat.v! - stMin[nat.s.id]).toFixed(1)} m` : '–', nat ? `natural lake at ${nat.s.name.replace(/^.* At /, '')}, above its lowest` : 'no gauge reading this month');
            hero(1, 'Before', 'the dam (1968)');
            const ny = natYears.find((d) => d.y === y);
            hero(3, ny ? `${ny.r.toFixed(1)} m` : '–', `natural swing in ${y}`);
          } else {
            const lv = levelAt(time);
            hero(0, lv != null ? `${lv.toFixed(1)} m` : '–', `above sea level · ${fmt.month(time)}`);
            hero(1, lv != null ? `${(hi - lv).toFixed(1)} m` : '–', 'below the record high');
            const ry = resvYears.find((d) => d.y === y);
            hero(3, ry ? `${ry.r.toFixed(1)} m` : '–', `swing in ${y}`);
          }
          hero(2, `${(hi - lo).toFixed(1)} m`, 'record range since 1969');
          setA(time); setB(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || info.layer?.id !== 'water-gauges') return null;
      const s = o.s;
      const ks = Object.keys(s.months).sort();
      return s.lake === 'reservoir'
        ? `<b>${esc(s.name)}</b><br><span class="tk">Level</span> <span class="tv">${o.v.toFixed(2)} m</span><br><span class="tk">Below record high</span> <span class="tv">${(stMax[s.id] - o.v).toFixed(1)} m</span><br><span class="tk">Record</span> <span class="tv">${ks[0]} → ${ks.at(-1)}</span>`
        : `<b>${esc(s.name)}</b><br><span class="tk">Natural lake, before the dam</span><br><span class="tk">Above its lowest</span> <span class="tv">${(o.v - stMin[s.id]).toFixed(1)} m</span><br><span class="tk">Record</span> <span class="tv">${ks[0]} → ${ks.at(-1)}</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// WILDFIRES — every mapped fire perimeter since 1919: flare, then a lasting scar

function firesLayer(data: Data): AtlasLayer {
  const color = '#ff7a45';
  const rows: Fire[] = data.fires?.rows ?? [];
  const polys = rows.flatMap((f) => f.g.map((poly) => ({ f, poly })));
  const small = rows.filter((f) => !f.g.length);
  const t0 = rows.length ? Math.floor(rows[0].t) : 1919;
  const t1 = rows.length ? Math.floor(rows.at(-1)!.t) : NOW;
  const haBy: Record<number, number> = {}, nBy: Record<number, number> = {};
  for (const f of rows) { const y = Math.floor(f.t); haBy[y] = (haBy[y] ?? 0) + f.ha; nBy[y] = (nBy[y] ?? 0) + 1; }
  const years = d3.range(t0, t1 + 1);
  const total = d3.sum(rows, (f) => f.ha);
  const topYear = years.reduce((a, b) => ((haBy[b] ?? 0) > (haBy[a] ?? 0) ? b : a), t0);
  const biggest = [...rows].sort((a, b) => b.ha - a.ha)[0];
  const recentTop = years.filter((y) => y >= 2000).reduce((a, b) => ((haBy[b] ?? 0) > (haBy[a] ?? 0) ? b : a), 2000);
  const byCause = [0, 1, 2].map((c) => d3.sum(rows.filter((f) => f.c === c), (f) => f.ha));
  const nCause = [0, 1, 2].map((c) => rows.filter((f) => f.c === c).length);
  const nearest = (f: Fire) => d3.least(data.places, (p) => km(p.lon, p.lat, f.x, f.y))!;
  const within = (y0: number, y1: number, r: number) => rows.filter((f) => f.t >= y0 && f.t < y1 && data.places.some((p) => km(p.lon, p.lat, f.x, f.y) <= r));
  const heat = d3.scaleLinear<string>().domain([0, 0.25, 0.6, 1]).range(['#fffbe0', '#ffd166', '#ff7a45', '#c2185b']).clamp(true);
  const decade = (d: number) => d3.sum(years.filter((y) => y >= d && y < d + 10), (y) => haBy[y] ?? 0);
  const intensity = (y: number) => Math.min(1, Math.sqrt((haBy[y] ?? 0) / (haBy[topYear] || 1)));
  const undated = (f: Fire) => Math.abs((f.t % 1) - 0.54) < 0.0006;

  const l: AtlasLayer = {
    id: 'fires',
    name: 'Wildfires',
    icon: '🔥',
    color,
    range: [t0, t1 + 0.99],
    available: rows.length > 0,
    unavailable: 'The BC Wildfire Service perimeters could not be downloaded. Run <code>npm run data fires</code>, then reload.',
    build({ time, speed }) {
      const W = glowWindow(speed, 1.2);
      const lo = lowerBound(rows, time - W, (f) => f.t);
      const hi = lowerBound(rows, time, (f) => f.t);
      const fresh = rows.slice(lo, hi);
      const freshPolys = fresh.flatMap((f) => f.g.map((poly) => ({ f, poly })));
      const age = (f: Fire) => (time - f.t) / W;
      return [
        new PolygonLayer<any>({
          id: 'fires-scars-base',
          data: polys,
          getPolygon: (d) => d.poly,
          filled: true,
          stroked: true,
          getFillColor: [120, 38, 30, 95],
          getLineColor: [255, 122, 69, 90],
          lineWidthMinPixels: 0.6,
          pickable: true,
          extensions: filterExt,
          getFilterValue: (d) => d.f.t,
          filterRange: [1800, time - W * 0.6],
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Fire>({
          id: 'fires-small-base',
          data: small,
          getPosition: (f) => [f.x, f.y],
          getRadius: 160,
          radiusMinPixels: 1.2,
          getFillColor: [255, 122, 69, 120],
          pickable: true,
          extensions: filterExt,
          getFilterValue: (f) => f.t,
          filterRange: [1800, time],
          parameters: NO_DEPTH,
        } as any),
        new PolygonLayer<any>({
          id: 'fires-flare',
          data: freshPolys,
          getPolygon: (d) => d.poly,
          extruded: true,
          wireframe: false,
          getElevation: (d) => (60 + Math.sqrt(d.f.ha) * 14) * (1 - age(d.f) * 0.7),
          getFillColor: (d) => rgb(heat(age(d.f)), 230 * (1 - age(d.f) * 0.6)),
          material: { ambient: 0.8, diffuse: 0.4 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
          parameters: ADDITIVE,
        }),
        new ScatterplotLayer<Fire>({
          id: 'fires-glow',
          data: fresh,
          getPosition: (f) => [f.x, f.y],
          getRadius: (f) => (200 + Math.sqrt(f.ha) * 40) * (1 + age(f)),
          radiusMinPixels: 3,
          getFillColor: (f) => rgb(heat(age(f)), 70 * (1 - age(f))),
          updateTriggers: { getRadius: time, getFillColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
    spark: () => years.map((x) => ({ x, y: Math.sqrt(haBy[x] ?? 0), color: heat(intensity(x)) })),
    events() {
      if (!rows.length) return [];
      const at = (f: Fire) => ({ lon: f.x, lat: f.y, zoom: 9 });
      const bigIn = (y: number) => [...rows].filter((f) => Math.floor(f.t) === y).sort((a, b) => b.ha - a.ha)[0];
      const out: AtlasEvent[] = [
        { t: topYear + 0.6, layer: 'fires', title: `${topYear}: the worst fire year on record`, body: `${fmt.int(haBy[topYear])} ha burned in the valley that year, the most since ${t0}.`, ...at(bigIn(topYear)) },
      ];
      if (biggest && Math.floor(biggest.t) !== topYear) out.push({ t: biggest.t, layer: 'fires', title: `${Math.floor(biggest.t)}: the largest single fire`, body: `Fire ${biggest.n} burned ${fmt.int(biggest.ha)} ha near ${nearest(biggest).name}.`, ...at(biggest) });
      if (recentTop !== topYear && haBy[recentTop]) out.push({ t: recentTop + 0.6, layer: 'fires', title: `${recentTop}: the biggest fire season this century`, body: `${fmt.int(haBy[recentTop])} ha burned in the valley, in ${nBy[recentTop]} fires.`, ...at(bigIn(recentTop)) });
      return out;
    },
    panel(el) {
      el.innerHTML = `${kicker(l, `BC Wildfire Service perimeters · ${t0} → ${t1}`)}
        <h2>A century of fire</h2>`;
      if (!l.available) return unavailableBox(el, l);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Every fire the province has mapped in the valley. Each one <b>flares</b> as it starts, then settles into a dark <b>scar</b> that stays on the map, so you can see where the forest has burned and how recently. Small fires are dots.</p>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Hectares burned each year</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        barChart(c, { data: years.map((x) => ({ x, y: haBy[x] ?? 0, color: heat(intensity(x)) })), xDomain: [t0, t1], color, height: 130, yFormat: (v) => (v >= 1000 ? `${v / 1000}k` : `${v}`), tooltip: (d) => `<b>${d.x}</b><br>${fmt.int(d.y)} ha in ${nBy[d.x] ?? 0} fires` }),
      );
      const near = within(2000, NOW + 1, 10);
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => heat(t))}"></div>
        <div class="ramp-labels"><span>just started</span><span>burning</span><span>cooling to a scar</span></div>
        <div class="callout" style="--c:${color}">Lightning started <b>${fmt.pct(nCause[0] / rows.length, 0)}</b> of these fires and people <b>${fmt.pct(nCause[1] / rows.length, 0)}</b>, but lightning fires burned <b>${fmt.pct(byCause[0] / (total || 1), 0)}</b> of the area. Since 2000, <b>${near.length}</b> fires started within 10 km of a community in the atlas. The 1920s burned <b>${fmt.int(decade(1920))} ha</b>; the 2010s burned <b>${fmt.int(decade(2010))} ha</b>.</div>
        <p class="note">Early perimeters were drawn by hand from old maps, and fires under a few hectares often weren’t mapped at all, so the early record undercounts small fires. A perimeter is the fire’s outer edge: patches inside it may not have burned. Fires with no recorded start date are placed in mid-July of their year. The box runs from Revelstoke to Castlegar and the ridges on both sides of the lakes.</p>
        ${sourceLine(data.fires!.source)}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          hero(0, `${fmt.int(haBy[y] ?? 0)} ha`, `burned in ${y}`);
          hero(1, fmt.int(nBy[y] ?? 0), `fires in ${y}`);
          const so = d3.sum(rows.slice(0, lowerBound(rows, time, (f) => f.t)), (f) => f.ha);
          hero(2, `${fmt.int(so / 1000)}k ha`, `burned since ${t0}`);
          hero(3, String(topYear), `worst year (${fmt.int(haBy[topYear] / 1000)}k ha)`);
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      const id = info.layer?.id ?? '';
      if (!o || !id.startsWith('fires')) return null;
      const f: Fire = o.f ?? o;
      return `<b>Fire ${esc(f.n)}</b><br><span class="tk">Started</span> <span class="tv">${undated(f) ? `${Math.floor(f.t)} (date unknown)` : fmt.date(f.t)}</span><br><span class="tk">Burned</span> <span class="tv">${fmt.int(f.ha)} ha</span><br><span class="tk">Cause</span> <span class="tv">${['lightning', 'people', 'unknown'][f.c]}</span><br><span class="tk">Near</span> <span class="tv">${esc(nearest(f).name)}</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// CLIMATE — adjusted annual temperatures at the long-running stations around the lakes

function climateLayer(data: Data): AtlasLayer {
  const color = '#f25f5c';
  const stations = data.climate?.stations ?? [];
  const div = d3.scaleLinear<string>().domain([-1.5, -0.4, 0, 0.4, 1.5]).range(['#2b6cb0', '#7fb3e6', '#9aa3b2', '#f4a08a', '#e0312b']).clamp(true);
  const gb = stations.find((s) => /revelstoke/i.test(s.name)) ?? stations[0];
  const anomalies: Record<number, number> = {};
  if (gb) for (const [y, v] of Object.entries(gb.temp)) anomalies[+y] = v - gb.baseline;
  // the regional average: the mean anomaly of every station reporting that year
  const regional: Record<number, number> = {};
  const ally = new Set(stations.flatMap((s) => Object.keys(s.temp).map(Number)));
  for (const y of ally) {
    const xs = stations.filter((s) => s.temp[y] != null).map((s) => s.temp[y] - s.baseline);
    if (xs.length >= 2) regional[y] = d3.mean(xs)!;
  }
  const ys = Object.keys(regional).map(Number).sort((a, b) => a - b);
  const y0 = ys[0] ?? 1900, y1 = ys.at(-1) ?? NOW;
  const warmest = ys.reduce((a, b) => (regional[b] > regional[a] ? b : a), y0);
  const slope = (pts: [number, number][]) => {
    if (pts.length < 10) return null;
    const mx = d3.mean(pts, (p) => p[0])!, my = d3.mean(pts, (p) => p[1])!;
    return d3.sum(pts, (p) => (p[0] - mx) * (p[1] - my)) / d3.sum(pts, (p) => (p[0] - mx) ** 2);
  };
  const trend = slope(ys.filter((y) => y >= 1950).map((y) => [y, regional[y]]));
  const N = data.normals?.stations[0];

  const l: AtlasLayer = {
    id: 'climate',
    name: 'Climate',
    icon: '🌡',
    color,
    range: [y0, y1 + 0.99],
    available: stations.length > 0,
    unavailable: 'The Environment Canada climate record could not be downloaded. Run <code>npm run data climate</code>.',
    build({ time, focusedId }) {
      const live = stations.map((s) => {
        const series = Object.fromEntries(Object.entries(s.temp).map(([k, v]) => [k, v - s.baseline]));
        return { s, a: interpYearly(series, time) };
      }).filter((d) => d.a != null) as { s: (typeof stations)[number]; a: number }[];
      const out: Layer[] = [
        new ColumnLayer<any>({
          id: 'climate-cols',
          data: live,
          getPosition: (d) => [d.s.lon, d.s.lat],
          radius: 3200,
          diskResolution: 6,
          extruded: true,
          getElevation: (d) => 1500 + Math.abs(d.a) * 20000,
          getFillColor: (d) => rgb(div(d.a), 240),
          material: { ambient: 0.65, diffuse: 0.5 },
          pickable: true,
          updateTriggers: { getElevation: time, getFillColor: time },
        }),
      ];
      if (focusedId === 'climate')
        out.push(label('climate-labels', live, (d) => [d.s.lon, d.s.lat, 1500 + Math.abs(d.a) * 20000 + 2500], (d) => `${d.a >= 0 ? '+' : '−'}${Math.abs(d.a).toFixed(1)}°`, { fontFamily: 'JetBrains Mono, monospace', updateTriggers: { getText: time, getPosition: time } }));
      return out;
    },
    spark: () => ys.map((x) => ({ x, y: regional[x], color: div(regional[x]) })),
    events: () => (ys.length ? [{ t: warmest + 0.5, layer: 'climate', title: `${warmest}: warmest year on record`, body: `The stations around the lakes averaged ${fmt.signed(regional[warmest])} °C above their 1961–1990 normal.` }] : []),
    panel(el) {
      el.innerHTML = `${kicker(l, 'Adjusted temperature record')}
        <h2>A warming valley</h2>`;
      if (!l.available) return unavailableBox(el, l);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Annual mean temperature at ${stations.length} long-running stations in the West Kootenay and the Columbia valley, each shown against its own 1961–1990 average. Columns grow and redden in warm years; blue means cooler than normal.</p>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>${esc(gb?.name ?? '')} warming stripes</h3>`);
      const gys = Object.keys(anomalies).map(Number).sort((a, b) => a - b);
      const setA = deferChart(el.appendChild(mk('div')), (c) => stripes(c, { cells: gys.map((x) => ({ x, color: div(anomalies[x]), label: `<b>${x}</b><br>${fmt.signed(anomalies[x], 2)} °C vs 1961–90` })), xDomain: [gys[0], gys.at(-1)!], height: 50 }));
      el.insertAdjacentHTML('beforeend', `<h3>Regional anomaly by year (°C)</h3>`);
      const setB = deferChart(el.appendChild(mk('div')), (c) => barChart(c, { data: l.spark(), xDomain: [y0, y1], color, height: 120, diverging: true, yFormat: (v) => fmt.signed(v, 1), tooltip: (d) => `<b>${d.x}</b><br>${fmt.signed(d.y, 2)} °C vs 1961–90` }));
      el.insertAdjacentHTML('beforeend', `
        <div class="ramp" style="background:${rampCSS((t) => div(-1.5 + t * 3))}"></div>
        <div class="ramp-labels"><span>−1.5 °C</span><span>normal</span><span>+1.5 °C</span></div>
        <div class="callout" style="--c:${color}">Since 1950 the region has warmed about <b>${trend != null ? fmt.signed(trend * 10, 2) : '–'} °C per decade</b>.</div>
        ${N ? `<h3>What a year feels like at ${esc(N.name)} (${N.period})</h3>
        <div class="metric-grid">
          ${metricTile('January', '#7fb3e6', `${N.monthly.tMean[0]?.toFixed(1) ?? '–'} °C`, `average · lows near ${N.monthly.tMin[0]?.toFixed(0) ?? '–'} °C`)}
          ${metricTile('July', '#f4a08a', `${N.monthly.tMean[6]?.toFixed(1) ?? '–'} °C`, `average · highs near ${N.monthly.tMax[6]?.toFixed(0) ?? '–'} °C`)}
          ${metricTile('Snowfall', '#e9f4ff', N.annual.snow != null ? `${fmt.int(N.annual.snow)} cm` : '–', 'a winter')}
          ${metricTile('Rain & snow', '#4cc9f0', N.annual.precip != null ? `${fmt.int(N.annual.precip)} mm` : '–', `a year · ${N.annual.wetDays ?? '–'} days with 1 mm+`)}
        </div>` : ''}
        <p class="note">AHCCD series are adjusted by Environment and Climate Change Canada to remove artificial jumps from station moves and instrument changes, so long-term trends are comparable. The “feels like” figures are this atlas’s own averages of ${N ? esc(N.name) : 'the station'}’s monthly records${N ? ` over ${N.period}` : ''}, not official climate normals. Snow falls far deeper on the mountains than at the lakeshore.</p>
        ${sourceLine(data.climate!.source + (N ? `; ${data.normals!.source}` : ''))}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          hero(0, anomalies[y] != null ? `${fmt.signed(anomalies[y])}°` : '–', `${gb?.name ?? ''} vs normal, ${y}`);
          hero(1, regional[y] != null ? `${fmt.signed(regional[y])}°` : '–', `regional average, ${y}`);
          hero(2, String(warmest), `warmest year (${fmt.signed(regional[warmest])}°)`);
          hero(3, trend != null ? `${fmt.signed(trend * 10, 2)}°` : '–', 'per decade since 1950');
          setA(time); setB(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('climate')) return null;
      const s = o.s, yrs = Object.keys(s.temp);
      return `<b>${esc(s.name)}</b><br><span class="tk">This year</span> <span class="tv">${fmt.signed(o.a, 2)} °C vs normal</span><br><span class="tk">1961–90 normal</span> <span class="tv">${s.baseline.toFixed(1)} °C</span><br><span class="tk">Record</span> <span class="tv">${yrs[0]}–${yrs.at(-1)}</span>`;
    },
  };
  return l;
}

const metricTile = (label: string, dot: string, v: string, sub: string) =>
  `<div class="metric"><div class="mk"><span class="dot" style="background:${dot}"></span>${label}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;

// ---------------------------------------------------------------------------------------------
// EARTHQUAKES — and the mine blasts that dominate the region's seismic record

function quakesLayer(data: Data): AtlasLayer {
  const color = '#f9d65c';
  const rows: Quake[] = data.quakes?.rows ?? [];
  const natural = rows.filter((q) => q[6] === 0);
  const mining = rows.length - natural.length;
  const EXAG = 3;
  const depthColor = d3.scaleSequential(d3.interpolateRgbBasis(['#fff1a8', '#ffb347', '#ff5f6d', '#b14aed'])).domain([0, 25]).clamp(true);
  const qColor = (q: Quake, a: number): RGBA => (q[6] ? [150, 140, 200, a * 0.7] : rgb(depthColor(q[2]), a));
  const radius = (m: number) => 900 * 1.9 ** (m - 2);
  const t0 = rows.length ? Math.floor(rows[0][4]) : 1985;
  const countByYear: Record<number, [number, number]> = {};
  for (const q of rows) { const y = Math.floor(q[4]); (countByYear[y] ??= [0, 0])[q[6]]++; }
  const biggest = [...natural].sort((a, b) => b[3] - a[3])[0];
  const nearest = (q: Quake) => d3.min(data.places, (p) => km(p.lon, p.lat, q[0], q[1])) ?? Infinity;
  const near100 = natural.filter((q) => nearest(q) <= 100);

  const l: AtlasLayer = {
    id: 'quakes',
    name: 'Earthquakes',
    icon: '◉',
    color,
    range: [t0, NOW + 0.99],
    available: rows.length > 0,
    unavailable: 'The NRCan earthquake catalogue could not be downloaded. Run <code>npm run data quakes</code>.',
    build({ time, speed }) {
      const W = glowWindow(speed, 1.4);
      const lo = lowerBound(rows, time - W, (q) => q[4]);
      const hi = lowerBound(rows, time, (q) => q[4]);
      const fresh = rows.slice(lo, hi);
      return [
        new ScatterplotLayer<Quake>({
          id: 'quakes-all',
          data: rows,
          getPosition: (q) => [q[0], q[1], -q[2] * 1000 * EXAG],
          getRadius: (q) => radius(q[3]) * 0.55,
          radiusMinPixels: 1.5,
          getFillColor: (q) => qColor(q, 160),
          stroked: true,
          getLineColor: [10, 14, 24, 160],
          lineWidthMinPixels: 0.5,
          pickable: true,
          extensions: filterExt,
          getFilterValue: (q) => q[4],
          filterRange: [1800, time],
          parameters: NO_DEPTH,
        } as any),
        new ScatterplotLayer<Quake>({
          id: 'quakes-ripples',
          data: fresh.filter((q) => q[3] >= 2.2),
          getPosition: (q) => [q[0], q[1], 0],
          getRadius: (q) => radius(q[3]) * (0.5 + 5 * ((time - q[4]) / W)),
          stroked: true,
          filled: false,
          lineWidthMinPixels: 1.5,
          getLineColor: (q) => qColor(q, 255 * (1 - (time - q[4]) / W)),
          updateTriggers: { getRadius: time, getLineColor: time },
          parameters: ADDITIVE,
        }),
        new ScatterplotLayer<Quake>({
          id: 'quakes-flash',
          data: fresh,
          getPosition: (q) => [q[0], q[1], -q[2] * 1000 * EXAG],
          getRadius: (q) => radius(q[3]) * (1.6 - (time - q[4]) / W),
          radiusMinPixels: 3,
          getFillColor: (q) => [255, 250, 220, 255 * (1 - (time - q[4]) / W) * (q[6] ? 0.4 : 1)],
          updateTriggers: { getRadius: time, getFillColor: time },
          parameters: ADDITIVE,
        }),
      ];
    },
    spark: () => d3.range(t0, NOW + 1).flatMap((x) => [{ x, y: countByYear[x]?.[0] ?? 0 }]),
    events: () => (biggest ? [{ t: biggest[4], layer: 'quakes', title: `M${biggest[3]}: largest natural quake in the region`, body: `${biggest[5]} · depth ${biggest[2]} km.`, lon: biggest[0], lat: biggest[1], zoom: 7 }] : []),
    panel(el) {
      el.innerHTML = `${kicker(l, `Seismic record · ${t0} → today`)}
        <h2>Solid ground</h2>`;
      if (!l.available) return unavailableBox(el, l);
      el.insertAdjacentHTML('beforeend', `<p class="lede">The Arrow Lakes lie in BC’s southern interior, hundreds of kilometres from the plate boundary that shakes the coast. Each dot is an event in Canada’s national catalogue across the southern interior and the Rockies, drawn at its depth (×${EXAG}). <b>Coloured</b> dots are earthquakes; <b>grey-violet</b> ones are blasts at mines and quarries.</p>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Magnitude over time</h3>`);
      const set = deferChart(el.appendChild(mk('div')), (c) =>
        scatterChart(c, {
          data: rows.map((q) => ({ x: q[4], y: q[3], r: Math.max(1.2, (q[3] - 1) ** 1.5 * 0.9), color: q[6] ? '#8f86c4' : depthColor(q[2]), label: `<b>M${q[3]}</b> · ${Math.floor(q[4])}<br>${esc(q[5])}` })),
          xDomain: [t0, NOW + 1], yDomain: [1.5, 4.5], height: 150, yFormat: (v) => `M${v}`,
        }),
      );
      el.insertAdjacentHTML('beforeend', `
        <div class="legend"><span><i class="sw" style="background:${depthColor(2)}"></i>earthquake</span><span><i class="sw" style="background:#8f86c4"></i>mine or quarry blast</span></div>
        <div class="callout" style="--c:${color}">Of ${fmt.int(rows.length)} events in the box since ${t0}, <b>${fmt.int(mining)}</b> were blasts. Natural quakes within 100 km of a valley community: <b>${near100.length}</b>${near100.length ? `, the largest M${d3.max(near100, (q) => q[3])}` : ''}.</div>
        <p class="note">The online catalogue starts in 1985. Small events are only listed where seismometers could detect them, so counts rise as the network grew. Shaking hazard in the interior is far lower than on the coast, but always check the building code’s seismic values for a specific site.</p>
        ${sourceLine(data.quakes!.source)}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          const c = countByYear[y] ?? [0, 0];
          hero(0, fmt.int(c[0]), `earthquakes in ${y}`);
          hero(1, fmt.int(c[1]), `blasts in ${y}`);
          hero(2, biggest ? `M${biggest[3]}` : '–', `largest quake (${biggest ? Math.floor(biggest[4]) : ''})`);
          hero(3, fmt.int(lowerBound(rows, time, (q) => q[4])), `events since ${t0}`);
          set(time);
        },
      };
    },
    tooltip(info) {
      const q = info.object as Quake;
      if (!q || !info.layer?.id.startsWith('quakes')) return null;
      return `<b>M${q[3]} ${q[6] ? 'blast' : 'earthquake'}</b><br>${esc(q[5])}<br><span class="tk">Date</span> <span class="tv">${fmt.date(q[4])}</span><br><span class="tk">Depth</span> <span class="tv">${q[2]} km</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// POPULATION — annual estimates per census subdivision, drawn at each one's main community

function populationLayer(data: Data): AtlasLayer {
  const color = '#3ecf8e';
  const P = data.population?.csds ?? {};
  const seats = data.csds.map((c) => ({ c, p: data.places.find((p) => p.key === c.seat) })).filter((d) => d.p) as { c: Data['csds'][number]; p: Place }[];
  const seatOf = new Map(seats.map((s) => [s.p.key, s.c]));
  const ys = [...new Set(Object.values(P).flatMap((s) => Object.keys(s).map(Number)))].sort((a, b) => a - b);
  const y0 = ys[0] ?? 2001, y1 = ys.at(-1) ?? NOW;
  const total = (y: number) => d3.sum(Object.values(P), (s) => s[y] ?? 0);
  // everyone outside the two cities: the villages and the rural electoral areas
  const rural = (y: number) => d3.sum(data.csds.filter((c) => !/^(Castlegar|Revelstoke)$/.test(c.name)), (c) => P[c.csd]?.[y] ?? 0);
  const growth = d3.scaleLinear<string>().domain([-0.15, 0, 0.15, 0.4]).range(['#e0457b', '#5d6b84', '#3ecf8e', '#b8ffde']).clamp(true);
  const change = (csd: string, t: number) => { const a = P[csd]?.[y0], b = interpYearly(P[csd], t); return a && b != null ? b / a - 1 : 0; };
  let shown = y0;

  const l: AtlasLayer = {
    id: 'population',
    name: 'Population',
    icon: '◍',
    color,
    range: [y0, y1 + 0.99],
    available: ys.length > 0,
    unavailable: 'The Statistics Canada estimates could not be downloaded. Run <code>npm run data population</code>.',
    build({ time }) {
      shown = time;
      return [placeColumns('population', seats.map((s) => s.p), (p) => interpYearly(P[seatOf.get(p.key)!.csd], time), (v) => 700 + Math.sqrt(v) * 190, (_v, p) => rgb(growth(change(seatOf.get(p.key)!.csd, time)), 240), time, 1500)];
    },
    spark: () => ys.map((x) => ({ x, y: total(x) })),
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, `Statistics Canada estimates · ${y0} → ${y1}`)}
        <h2>Who lives along the lakes</h2>`;
      if (!l.available) return unavailableBox(el, l);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Column height is the population of each city, village or regional-district area, drawn at its main community. Colour shows growth since ${y0}: <b>green</b> growing, <b>grey</b> flat, <b>pink</b> shrinking.</p>`);
      const hero = heroStats(el, 4);
      el.insertAdjacentHTML('beforeend', `<h3>Population by community</h3>`);
      const palette = ['#3ecf8e', '#4cc9f0', '#ffd166', '#ff8a3d', '#b388ff', '#ff5d8f'];
      const big = seats.filter((s) => (P[s.c.csd]?.[y1] ?? 0) >= 1000).sort((a, b) => (P[b.c.csd][y1] ?? 0) - (P[a.c.csd][y1] ?? 0));
      const series = seats.map((s) => {
        const i = big.indexOf(s);
        return { key: s.c.csd, label: s.c.short ?? s.c.name, color: i >= 0 ? palette[i % palette.length] : '#5d6b84', muted: i < 0, width: i >= 0 ? 2 : 1, values: Object.entries(P[s.c.csd] ?? {}).map(([y, v]) => ({ x: +y, y: v })) };
      });
      const set = deferChart(el.appendChild(mk('div')), (c) => lineChart(c, { series, xDomain: [y0, y1], height: 160, valueFormat: fmt.int }));
      el.insertAdjacentHTML('beforeend', `<div class="legend">${series.filter((s) => !s.muted).map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}<span><i class="sw" style="background:#5d6b84"></i>smaller communities</span></div>
        <div class="ramp" style="background:${rampCSS((t) => growth(-0.15 + t * 0.55))}"></div>
        <div class="ramp-labels"><span>−15%</span><span>flat</span><span>+40%</span></div>
        <div class="callout" style="--c:${color}">Valley-wide the population changed <b>${fmt.signed((total(y1) / total(y0) - 1) * 100, 0)}%</b> from ${y0} to ${y1}. <b>${fmt.pct(rural(y1) / total(y1), 0)}</b> of residents live outside Castlegar and Revelstoke.</div>
        <p class="note">Estimates are for July 1 each year on 2021 boundaries. Area figures cover whole regional-district electoral areas, which reach well beyond the lakeshore. Seasonal residents aren’t counted: lakeside roads are far busier in summer than these numbers suggest.</p>
        ${sourceLine(data.population!.source)}`);
      return {
        update({ time }) {
          const y = Math.floor(time);
          hero(0, fmt.int(total(y)), `residents in ${y}`);
          hero(1, `${fmt.signed((total(y) / total(y0) - 1) * 100, 1)}%`, `since ${y0}`);
          const fast = seats.filter((s) => (P[s.c.csd]?.[y0] ?? 0) >= 300).sort((a, b) => change(b.c.csd, time) - change(a.c.csd, time))[0];
          hero(2, fast ? (fast.c.short ?? fast.c.name) : '–', fast ? `fastest growing (${fmt.signed(change(fast.c.csd, time) * 100, 0)}%)` : '');
          hero(3, fmt.int(rural(y)), 'outside the two cities');
          set(time);
        },
      };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('population')) return null;
      const c = seatOf.get(o.p.key)!;
      return `<b>${esc(c.short ?? c.name)}</b><br><span class="tk">Population ${Math.floor(shown)}</span> <span class="tv">${fmt.int(o.v)}</span><br><span class="tk">Since ${y0}</span> <span class="tv">${fmt.signed(change(c.csd, shown) * 100, 0)}%</span><br><span class="tk">Click for ${esc(o.p.name)}’s report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// HOMES & INCOMES — 2021 Census, per city, village or area

function homesLayer(data: Data): AtlasLayer {
  const color = '#b388ff';
  const C = data.census?.csds ?? {};
  const rows = data.places.filter((p) => !p.fn).map((p) => ({ p, c: C[p.csd] })).filter((d) => d.c?.value != null);
  const ramp = d3.scaleSequential(d3.interpolateRgb('#3a2a7a', '#f0d9ff')).domain([320000, 760000]).clamp(true);

  const l: AtlasLayer = {
    id: 'homes',
    name: 'Homes & incomes',
    icon: '⌂',
    color,
    range: [2021, 2021.99],
    static: true,
    period: '2021 Census',
    available: rows.length > 0,
    unavailable: 'The 2021 Census profile could not be downloaded. Run <code>npm run data census</code>.',
    build() {
      return [placeColumns('homes', data.places, (p) => (p.fn ? null : C[p.csd]?.value ?? null), (v) => 500 + (v / 1000) * 30, (v) => rgb(ramp(v), 240), 0)];
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Homes & incomes · 2021 Census')}
        <h2>What a home is worth here</h2>`;
      if (!l.available) return unavailableBox(el, l);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Column height is the <b>median value of owner-occupied homes</b> in each city, village or rural area, as owners estimated them for the 2021 Census. Places in the same area share one value.</p>`);
      const csdRows = [...new Map(rows.map((r) => [r.p.csd, r])).values()].sort((a, b) => a.c.value! - b.c.value!);
      const max = d3.max(csdRows, (r) => r.c.value!) ?? 1;
      const csdName = (r: (typeof rows)[number]) => esc(r.p.csdName);
      el.insertAdjacentHTML('beforeend', `
        <h3>Median home value, lowest first</h3>
        <ol class="rank-list">${csdRows.map((r, i) => `<li data-key="${esc(r.p.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${csdName(r)}</span><br><span class="rd">${fmt.money(r.c.income ?? 0)} median household income · ${r.c.s65 != null ? fmt.pct(r.c.s65, 0) : '–'} aged 65+</span></span><span><div class="bar"><i style="width:${Math.round((r.c.value! / max) * 100)}%;background:${ramp(r.c.value!)}"></i></div><div class="bar-v">${fmt.money(r.c.value!)}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(320000 + t * 440000))}"></div>
        <div class="ramp-labels"><span>$320K</span><span>$540K</span><span>$760K+</span></div>
        <div class="callout" style="--c:${color}">These are 2021 figures: owners’ own estimates in May 2021, near the top of the pandemic market. Treat them as a guide to which areas cost more, not as today’s asking prices. Revelstoke’s ski-town market and the large rural areas pull the top of the range up.</div>
        <p class="note">British Columbia has no open record of individual house sales (BC Assessment and MLS data aren’t openly licensed), so the census is the only open, consistent source for every area. Small areas’ figures are rounded and based on a 25% sample.</p>
        ${sourceLine(data.census!.source)}`);
      el.querySelector('.rank-list')!.addEventListener('click', (e) => {
        const li = (e.target as HTMLElement).closest('li');
        if (li) window.dispatchEvent(new CustomEvent('atlas:place', { detail: li.dataset.key }));
      });
      return { update() {} };
    },
    tooltip(info) {
      const o: any = info.object;
      if (!o || !info.layer?.id.startsWith('homes')) return null;
      const c = C[o.p.csd];
      return `<b>${esc(o.p.name)}</b> <span class="tk">· ${esc(o.p.csdName)}</span><br><span class="tk">Median home value</span> <span class="tv">${fmt.money(o.v)}</span><br><span class="tk">Household income</span> <span class="tv">${c?.income ? fmt.money(c.income) : '–'}</span><br><span class="tk">Click for place report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// HEALTH CARE — drive time to the nearest hospital (and the regional hospital in Trail)

function healthLayer(data: Data): AtlasLayer {
  const color = '#6c8cff';
  const D = data.drive;
  const hosp = D?.hospitals ?? [];
  const er = (p: Place) => D?.places[p.key]?.er[0] ?? null;
  const ramp = d3.scaleLinear<string>().domain([5, 30, 120]).range(['#e3f1ff', color, '#e0457b']).interpolate(d3.interpolateRgb).clamp(true);
  const height = (v: number) => 900 + Math.min(v, 180) * 60;
  type Row = { t: Trip; path: [number, number][]; cum: number[]; i: number };
  let memoKey: string | null = null, memo: Row[] = [];
  const rowsFor = (key: string | null) => {
    if (key === memoKey) return memo;
    memoKey = key;
    const p = data.places.find((x) => x.key === key);
    const rec = p && D?.places[p.key];
    memo = !rec ? [] : rec.er.slice(0, 2).map((t, i) => {
      const path: [number, number][] = t.line ?? [[p!.lon, p!.lat], [t.lon, t.lat]];
      const cum = [0];
      for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], (path[k][1] - path[k - 1][1]) * 1.55));
      return { t, path, cum, i };
    });
    return memo;
  };
  const along = (r: Row, q: number): [number, number] => {
    const d = q * r.cum[r.cum.length - 1];
    const k = Math.max(1, lowerBound(r.cum, d, (c) => c));
    if (k >= r.path.length) return r.path[r.path.length - 1];
    const f = (d - r.cum[k - 1]) / (r.cum[k] - r.cum[k - 1] || 1);
    return [r.path[k - 1][0] + (r.path[k][0] - r.path[k - 1][0]) * f, r.path[k - 1][1] + (r.path[k][1] - r.path[k - 1][1]) * f];
  };
  const hm = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;

  const l: AtlasLayer = {
    id: 'health',
    name: 'Health care',
    icon: '✚',
    color,
    range: [NOW, NOW + 0.99],
    static: true,
    period: 'drive times today',
    available: !!D && hosp.length > 0,
    unavailable: 'Drive times could not be computed. Run <code>npm run data osm drive</code>.',
    build({ selected, hovered, focusedId, clock }) {
      const out: Layer[] = [];
      if (focusedId === 'health') out.push(placeColumns('health', data.places, (p) => er(p)?.min ?? null, height, (v) => rgb(ramp(v), 235), 0, 1300));
      const rows = rowsFor(hovered ?? selected);
      if (rows.length) {
        const q = (clock % 3200) / 3200;
        out.push(
          new PathLayer<Row>({ id: 'health-trips', data: rows, getPath: (r) => r.path, getColor: (r) => (r.i === 0 ? [255, 255, 255, 235] : rgb(color, 170)), getWidth: (r) => (r.i === 0 ? 4 : 2.5), widthUnits: 'pixels', capRounded: true, jointRounded: true, extensions: dashExt, getDashArray: (r) => (r.t.line ? [0, 0] : [3, 2]), parameters: NO_DEPTH } as any),
          new ScatterplotLayer<Row>({ id: 'health-pulse', data: rows, getPosition: (r) => along(r, q), getRadius: 900, radiusMinPixels: 3, getFillColor: (r) => (r.i === 0 ? [255, 255, 255, 230] : rgb(color, 230)), updateTriggers: { getPosition: q }, parameters: ADDITIVE }),
          label('health-mins', rows, (r) => r.path[r.path.length - 1] as any, (r) => `${r.t.min} min\n${r.t.name}`, { getSize: (r: Row) => (r.i === 0 ? 13 : 11), getPixelOffset: [0, -14] }),
        );
      }
      const p = (clock % 2400) / 2400;
      out.push(
        new ScatterplotLayer<any>({ id: 'health-halo', data: hosp, getPosition: (f) => [f.lon, f.lat], getRadius: 1200 + p * 5500, radiusMinPixels: 5, stroked: true, filled: false, lineWidthMinPixels: 1.5, getLineColor: rgb(color, 210 * (1 - p)), updateTriggers: { getRadius: p, getLineColor: p }, parameters: NO_DEPTH } as any),
        new ScatterplotLayer<any>({ id: 'health-sites', data: hosp, getPosition: (f) => [f.lon, f.lat], getRadius: 1000, radiusMinPixels: 6, radiusMaxPixels: 13, getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: rgb(color), lineWidthMinPixels: 2.5, pickable: true, parameters: { depthCompare: 'always' } } as any),
      );
      if (focusedId === 'health') out.push(label('health-site-labels', hosp, (f) => [f.lon, f.lat], (f) => f.name, { getPixelOffset: [0, -12], getColor: [200, 212, 255, 240] }));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Health care · drive times today')}
        <h2>How far to the hospital?</h2>`;
      if (!l.available) return unavailableBox(el, l);
      el.insertAdjacentHTML('beforeend', `<p class="lede">The hospitals the valley’s communities drive to: ${hosp.map((h) => `<b>${esc(h.name)}</b>`).join(', ')}. Column height is the typical drive from each community to the nearest one. Hover or click a community to see the road there. Serious cases go on to <b>${esc(data.osm?.city.name ?? 'the regional hospital in Trail')}</b>.</p>`);
      const hero = heroStats(el, 4);
      const rows = data.places.map((p) => ({ p, e: er(p), s: D!.places[p.key]?.city })).filter((r) => r.e) as { p: Place; e: Trip; s: Trip | null }[];
      rows.sort((a, b) => a.e.min - b.e.min);
      hero(0, `${Math.round(d3.median(rows, (r) => r.e.min) ?? 0)} min`, 'median drive to a hospital');
      hero(1, `${rows.filter((r) => r.e.min <= 20).length} of ${rows.length}`, 'communities within 20 min');
      const far = rows.at(-1);
      hero(2, far ? `${far.e.min} min` : '–', far ? `farthest: ${far.p.name}` : '');
      hero(3, `${Math.round(d3.median(rows, (r) => r.s?.min ?? NaN) ?? 0)} min`, 'median drive to the regional hospital');
      const max = d3.max(rows, (r) => r.e.min) ?? 1;
      el.insertAdjacentHTML('beforeend', `
        <h3>Drive to the nearest hospital</h3>
        <ol class="rank-list">${rows.map((r, i) => `<li data-key="${esc(r.p.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.p.name)}</span><br><span class="rd">${esc(r.e.name)} · ${Math.round(r.e.km)} km${r.s ? ` · Trail ${hm(r.s.min)}` : ''}</span></span><span><div class="bar"><i style="width:${Math.round((r.e.min / max) * 100)}%;background:${ramp(r.e.min)}"></i></div><div class="bar-v">${r.e.min}</div></span></li>`).join('')}</ol>
        <div class="ramp" style="background:${rampCSS((t) => ramp(5 + t * 115))}"></div>
        <div class="ramp-labels"><span>5 min</span><span>30</span><span>2 h+</span></div>
        <div class="callout" style="--c:#ff6b6b"><b>Check emergency hours before you rely on one.</b> Small hospitals and health centres in the Interior sometimes cut emergency-department hours or close temporarily when they are short of staff. Interior Health posts current service changes; in an emergency, call 9-1-1.</div>
        <div class="callout" style="--c:${color}">Specialist care (cardiac, cancer, most surgery) means the drive to Kootenay Boundary Regional Hospital in Trail, or on to Kelowna General, or an air ambulance.</div>
        <p class="note">Hospitals are as mapped in OpenStreetMap. Drive times are the OSRM router’s estimate for free-flowing traffic on OpenStreetMap roads and ferries, from each community’s centre. They don’t include ferry waits, winter mountain passes or road closures.</p>
        ${sourceLine(`${D!.source}; hospitals from ${data.osm!.source}`)}`);
      el.querySelector('.rank-list')!.addEventListener('click', (e) => {
        const li = (e.target as HTMLElement).closest('li');
        if (li) window.dispatchEvent(new CustomEvent('atlas:place', { detail: li.dataset.key }));
      });
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('health')) return null;
      if (id === 'health-sites') return `<b>${esc(info.object.name)}</b><br><span class="tk">Hospital</span>`;
      const o: any = info.object;
      const e = o.p ? er(o.p) : null;
      if (!e) return null;
      return `<b>${esc(o.p.name)}</b><br><span class="tk">Nearest hospital</span> <span class="tv">${e.min} min</span><br><span class="tk">${esc(e.name)} · ${Math.round(e.km)} km</span><br><span class="tk">Click for place report</span>`;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// VALLEY LIFE — beaches, hot springs, waterfalls, trails and the everyday places, from OpenStreetMap

export const POI_STYLE: Record<string, { label: string; color: string; group: 'water' | 'outdoors' | 'culture' | 'everyday' }> = {
  beach: { label: 'Beach', color: '#ffd99a', group: 'water' },
  marina: { label: 'Marina or launch', color: '#4cc9f0', group: 'water' },
  hotspring: { label: 'Hot spring', color: '#ffa98a', group: 'water' },
  waterfall: { label: 'Waterfall', color: '#8be3ff', group: 'outdoors' },
  viewpoint: { label: 'Lookout', color: '#c5e86c', group: 'outdoors' },
  nature: { label: 'Park or reserve', color: '#5ad18a', group: 'outdoors' },
  camp: { label: 'Campground', color: '#7ee0a0', group: 'outdoors' },
  golf: { label: 'Golf course', color: '#9be27a', group: 'outdoors' },
  museum: { label: 'Museum or gallery', color: '#d6a2ff', group: 'culture' },
  attraction: { label: 'Attraction', color: '#ff9fd1', group: 'culture' },
  grocery: { label: 'Supermarket', color: '#ffb35c', group: 'everyday' },
  store: { label: 'Store', color: '#ffcf8a', group: 'everyday' },
  food: { label: 'Restaurant or café', color: '#ff8a6b', group: 'everyday' },
  pharmacy: { label: 'Pharmacy', color: '#8fa8ff', group: 'everyday' },
  clinic: { label: 'Clinic', color: '#8fa8ff', group: 'everyday' },
  hospital: { label: 'Hospital', color: '#6c8cff', group: 'everyday' },
  school: { label: 'School', color: '#b4bfd2', group: 'everyday' },
  library: { label: 'Library', color: '#b4bfd2', group: 'everyday' },
  civic: { label: 'Town hall or community centre', color: '#9aa6bd', group: 'everyday' },
  fuel: { label: 'Gas station', color: '#9aa6bd', group: 'everyday' },
  airport: { label: 'Airport', color: '#e9eef7', group: 'everyday' },
};
const GROUPS = [
  { id: 'water', label: 'Water', color: '#4cc9f0' },
  { id: 'outdoors', label: 'Outdoors', color: '#34d399' },
  { id: 'culture', label: 'Culture', color: '#d6a2ff' },
  { id: 'everyday', label: 'Everyday', color: '#ffb35c' },
] as const;

function lifeLayer(data: Data): AtlasLayer {
  const color = '#ffd166';
  const pois = (data.osm?.pois ?? []).filter((p) => POI_STYLE[p[2]]);
  const trails = data.osm?.trails ?? [];
  const on = new Set<string>(['water', 'outdoors', 'culture', 'everyday']);
  const springs = pois.filter((p) => p[2] === 'hotspring');
  const falls = pois.filter((p) => p[2] === 'waterfall');

  const l: AtlasLayer = {
    id: 'life',
    name: 'Valley life',
    icon: '✦',
    color,
    range: [NOW, NOW + 0.99],
    static: true,
    period: 'mapped today',
    available: pois.length > 0,
    unavailable: 'OpenStreetMap could not be reached. Run <code>npm run data osm</code>.',
    build({ clock }) {
      const shown = pois.filter((p) => on.has(POI_STYLE[p[2]].group) && p[2] !== 'hotspring' && p[2] !== 'waterfall');
      const out: Layer[] = [];
      if (on.has('outdoors')) {
        out.push(
          new PathLayer<any>({ id: 'life-trails-glow', data: trails.flatMap((t) => t.parts.map((path) => ({ t, path }))), getPath: (d) => d.path, getColor: [52, 211, 153, 70], getWidth: 7, widthUnits: 'pixels', parameters: ADDITIVE }),
          new PathLayer<any>({ id: 'life-trails', data: trails.flatMap((t) => t.parts.map((path) => ({ t, path }))), getPath: (d) => d.path, getColor: [170, 255, 214, 230], getWidth: 1.6, widthUnits: 'pixels', pickable: true, parameters: NO_DEPTH }),
        );
        // waterfalls: a cool beam and a slow ripple
        const p = (clock % 2200) / 2200;
        out.push(
          new ColumnLayer<Poi>({ id: 'life-falls-beam', data: falls, getPosition: (f) => [f[0], f[1]], radius: 160, extruded: true, getElevation: 3600, getFillColor: [139, 227, 255, 120], pickable: true, parameters: ADDITIVE } as any),
          new ScatterplotLayer<Poi>({ id: 'life-falls-ring', data: falls, getPosition: (f) => [f[0], f[1]], getRadius: 300 + p * 1800, stroked: true, filled: false, lineWidthMinPixels: 1.5, getLineColor: [139, 227, 255, 220 * (1 - p)], updateTriggers: { getRadius: p, getLineColor: p }, parameters: ADDITIVE } as any),
        );
      }
      if (on.has('water') && springs.length) {
        // hot springs: a warm column with rings of steam rising off it
        const puffs = springs.flatMap((s, i) => [0, 1, 2].map((k) => ({ s, q: ((clock / 3000 + k / 3 + i * 0.17) % 1) })));
        out.push(
          new ColumnLayer<Poi>({ id: 'life-springs-col', data: springs, getPosition: (f) => [f[0], f[1]], radius: 220, extruded: true, getElevation: 1400, getFillColor: [255, 169, 138, 190], pickable: true, parameters: ADDITIVE } as any),
          new ScatterplotLayer<any>({ id: 'life-springs-steam', data: puffs, getPosition: (d) => [d.s[0], d.s[1], 1400 + d.q * 2600], getRadius: (d) => 250 + d.q * 900, stroked: true, filled: false, lineWidthMinPixels: 1.5, getLineColor: (d) => [255, 214, 196, 200 * (1 - d.q)], updateTriggers: { getPosition: clock, getRadius: clock, getLineColor: clock }, parameters: ADDITIVE } as any),
        );
      }
      out.push(
        new ScatterplotLayer<Poi>({ id: 'life-glow', data: shown, getPosition: (p) => [p[0], p[1]], getRadius: 600, radiusMinPixels: 6, radiusMaxPixels: 18, getFillColor: (p) => rgb(POI_STYLE[p[2]].color, 50), updateTriggers: { getFillColor: [...on].join() }, parameters: ADDITIVE } as any),
        new ScatterplotLayer<Poi>({ id: 'life-pois', data: shown, getPosition: (p) => [p[0], p[1]], getRadius: 220, radiusMinPixels: 3, radiusMaxPixels: 7, getFillColor: (p) => rgb(POI_STYLE[p[2]].color, 245), stroked: true, getLineColor: [6, 10, 18, 220], lineWidthMinPixels: 1, pickable: true, parameters: { depthCompare: 'always' } } as any),
      );
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Valley life · OpenStreetMap')}
        <h2>The good stuff</h2>`;
      if (!l.available) return unavailableBox(el, l);
      const count = (cat: string) => pois.filter((p) => p[2] === cat).length;
      const trailKm = d3.sum(trails, (t) => t.km);
      el.insertAdjacentHTML('beforeend', `<p class="lede">Everything residents and visitors have mapped in the valley: <b>${count('beach')}</b> beaches, <b>${count('marina')}</b> marinas and launches, <b>${springs.length}</b> hot springs (rising steam), <b>${falls.length}</b> waterfalls (blue beams), <b>${count('camp')}</b> campgrounds and <b>${trails.length}</b> named trails (green). Switch groups on and off below.</p>
        <div class="chips life-groups">${GROUPS.map((g) => `<button class="chip on" data-g="${g.id}" style="--c:${g.color}">${g.label}</button>`).join('')}</div>`);
      const hero = heroStats(el, 4);
      hero(0, String(springs.length), 'hot springs');
      hero(1, `${trailKm.toFixed(0)} km`, 'of named trail');
      hero(2, String(count('camp')), 'campgrounds');
      hero(3, String(count('viewpoint')), 'lookouts');
      const bigTrails = [...trails].filter((t) => !/snowmobile/i.test(t.name)).sort((a, b) => b.km - a.km).slice(0, 8);
      el.insertAdjacentHTML('beforeend', `
        <h3>Longest trails</h3>
        <ol class="rank-list">${bigTrails.map((t, i) => `<li data-trail="${i}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(t.name)}</span><br><span class="rd">${t.route ? 'signed route' : 'named trail'}</span></span><span><div class="bar"><i style="width:${Math.round((t.km / bigTrails[0].km) * 100)}%;background:#34d399"></i></div><div class="bar-v">${t.km} km</div></span></li>`).join('')}</ol>
        <h3>Legend</h3>
        <div class="legend">${Object.entries(POI_STYLE).filter(([k]) => count(k)).map(([k, s]) => `<span><i class="sw" style="background:${s.color}"></i>${s.label} <b class="mono">${count(k)}</b></span>`).join('')}</div>
        <p class="note">OpenStreetMap is mapped by volunteers, so coverage is uneven: a missing beach or shop may simply not be mapped yet. Names come from the map as typed. Beaches on a reservoir move with the water: many appear only when the lake is drawn down.</p>
        ${sourceLine(data.osm!.source)}`);
      el.querySelectorAll<HTMLButtonElement>('.life-groups .chip').forEach((b) =>
        b.addEventListener('click', () => {
          const g = b.dataset.g!;
          if (on.has(g)) on.delete(g); else on.add(g);
          b.classList.toggle('on', on.has(g));
        }),
      );
      el.querySelectorAll<HTMLElement>('[data-trail]').forEach((li) =>
        li.addEventListener('click', () => {
          const t = bigTrails[+li.dataset.trail!];
          const pts = t.parts.flat();
          window.dispatchEvent(new CustomEvent('atlas:fit', { detail: [d3.min(pts, (p) => p[0]), d3.min(pts, (p) => p[1]), d3.max(pts, (p) => p[0]), d3.max(pts, (p) => p[1])] }));
        }),
      );
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      if (!info.object || !id.startsWith('life')) return null;
      if (id === 'life-trails') { const t = info.object.t as Trail; return `<b>${esc(t.name)}</b><br><span class="tk">Trail</span> <span class="tv">${t.km} km</span><br><span class="tk">Click for its trail report</span>`; }
      if (id === 'life-springs-steam') return null;
      const p = info.object as Poi;
      const s = POI_STYLE[p[2]];
      return `<b>${esc(p[3] ?? s.label)}</b><br><span class="tk">${s.label}${p[2] === 'waterfall' ? ' · click for its report' : ''}</span>`;
    },
    // trails and waterfalls open their report on the Hikes & waterfalls layer
    click(info) {
      const id = info.layer?.id ?? '';
      const c = info.coordinate as [number, number] | undefined;
      const v = id === 'life-trails' && c ? hikeViewAt('trail', c[0], c[1]) : id === 'life-falls-beam' ? hikeViewAt('fall', (info.object as Poi)[0], (info.object as Poi)[1]) : null;
      if (!v) return false;
      openHikeView(v);
      return true;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------
// GETTING AROUND — the free inland ferries, the airports and the drive to the valley's airport

function accessLayer(data: Data): AtlasLayer {
  const color = '#ff8a3d';
  const O = data.osm, D = data.drive;
  const ferry = O?.ferry ?? [];
  const airports = (O?.pois ?? []).filter((p) => p[2] === 'airport');
  const toAirport = (p: Place) => D?.places[p.key]?.airport?.min ?? null;
  const ramp = d3.scaleLinear<string>().domain([0, 60, 200]).range(['#ffe7cf', color, '#c2185b']).interpolate(d3.interpolateRgb).clamp(true);
  // ferry paths with cumulative lengths for the boats
  const fp = ferry.map((f) => {
    const cum = [0];
    for (let k = 1; k < f.path.length; k++) cum.push(cum[k - 1] + Math.hypot(f.path[k][0] - f.path[k - 1][0], (f.path[k][1] - f.path[k - 1][1]) * 1.55));
    return { ...f, cum };
  });
  const along = (f: (typeof fp)[number], q: number): [number, number] => {
    const d = q * f.cum[f.cum.length - 1];
    const k = Math.max(1, lowerBound(f.cum, d, (c) => c));
    if (k >= f.path.length) return f.path[f.path.length - 1];
    const t = (d - f.cum[k - 1]) / (f.cum[k] - f.cum[k - 1] || 1);
    return [f.path[k - 1][0] + (f.path[k][0] - f.path[k - 1][0]) * t, f.path[k - 1][1] + (f.path[k][1] - f.path[k - 1][1]) * t];
  };
  const mid = (f: (typeof fp)[number]) => f.path[Math.floor(f.path.length / 2)];
  const h = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

  const l: AtlasLayer = {
    id: 'access',
    name: 'Getting around',
    icon: '⛴',
    color,
    range: [NOW, NOW + 0.99],
    static: true,
    period: 'roads and ferries today',
    available: !!O && !!D,
    unavailable: 'Run <code>npm run data osm drive</code> to build this layer.',
    build({ clock, focusedId }) {
      const out: Layer[] = [];
      if (focusedId === 'access') out.push(placeColumns('access', data.places, toAirport, (v) => 700 + v * 40, (v) => rgb(ramp(v), 235), 0, 1300));
      out.push(
        new PathLayer<any>({ id: 'access-ferry-glow', data: fp, getPath: (f) => f.path, getColor: rgb(color, 90), getWidth: 10, widthUnits: 'pixels', parameters: ADDITIVE }),
        new PathLayer<any>({ id: 'access-ferry', data: fp, getPath: (f) => f.path, getColor: rgb('#ffe2c4', 230), getWidth: 1.8, widthUnits: 'pixels', extensions: dashExt, getDashArray: [5, 4], pickable: true, parameters: NO_DEPTH } as any),
        // one boat per ferry, shuttling back and forth (longer crossings take longer)
        new ScatterplotLayer<any>({ id: 'access-boat', data: fp, getPosition: (f) => { const per = 3000 + f.km * 1800, q = (clock % per) / per; return along(f, q < 0.5 ? q * 2 : 2 - q * 2); }, getRadius: 600, radiusMinPixels: 5, getFillColor: [255, 255, 255, 255], updateTriggers: { getPosition: clock }, parameters: ADDITIVE }),
        new ScatterplotLayer<Poi>({ id: 'access-airports', data: airports, getPosition: (a) => [a[0], a[1]], getRadius: 700, radiusMinPixels: 5, getFillColor: [16, 22, 38, 240], stroked: true, getLineColor: [233, 238, 247, 255], lineWidthMinPixels: 2, pickable: true, parameters: { depthCompare: 'always' } } as any),
      );
      if (focusedId === 'access') out.push(label('access-labels', [...fp.map((f) => ({ n: f.name, x: mid(f)[0], y: mid(f)[1] })), ...airports.map((a) => ({ n: a[3] ?? 'Airport', x: a[0], y: a[1] }))], (d) => [d.x, d.y], (d) => d.n, { getPixelOffset: [0, -12], getColor: [255, 226, 196, 240] }));
      return out;
    },
    spark: () => [],
    events: () => [],
    panel(el) {
      el.innerHTML = `${kicker(l, 'Getting around · roads and ferries')}
        <h2>Ferries, passes and one airport</h2>`;
      if (!l.available) return unavailableBox(el, l);
      el.insertAdjacentHTML('beforeend', `<p class="lede">The lakes cut the valley in two, so its highways cross by <b>free inland ferries</b>: the Upper Arrow Lake ferry between Shelter Bay and Galena Bay on the road from Nakusp to Revelstoke, and the Needles cable ferry on Highway 6 west toward the Okanagan. <b>West Kootenay Regional Airport</b> at Castlegar is the valley’s airport with scheduled flights. Column height is the drive from each community to it.</p>`);
      const hero = heroStats(el, 4);
      const rows = data.places.map((p) => ({ p, a: D!.places[p.key]?.airport, c: D!.places[p.key]?.city, k: D!.places[p.key]?.kelowna })).filter((r) => r.a) as { p: Place; a: Trip; c: Trip | null; k: Trip | null }[];
      rows.sort((a, b) => a.a.min - b.a.min);
      hero(0, `${Math.round(d3.median(rows, (r) => r.a.min) ?? 0)} min`, 'median drive to the airport');
      hero(1, `${Math.round(d3.median(rows, (r) => r.k?.min ?? NaN) ?? 0)} min`, 'median drive to Kelowna');
      hero(2, String(fp.length), 'free ferries on the map');
      hero(3, String(airports.length), 'airports and airstrips');
      el.insertAdjacentHTML('beforeend', `
        <h3>Drive times (h:mm)</h3>
        <table class="dtable"><thead><tr><th>From</th><th>Airport</th><th>Trail</th><th>Kelowna</th></tr></thead><tbody>
        ${rows.map((r) => `<tr data-key="${esc(r.p.key)}"><td>${esc(r.p.name)}</td><td>${h(r.a.min)}</td><td>${r.c ? h(r.c.min) : '–'}</td><td>${r.k ? h(r.k.min) : '–'}</td></tr>`).join('')}
        </tbody></table>
        <h3>Ferries</h3>
        <ol class="rank-list">${fp.map((f, i) => `<li><span class="rk">${i + 1}</span><span><span class="nm">${esc(f.name)}</span><br><span class="rd">${f.km} km crossing</span></span><span></span></li>`).join('')}</ol>
        <div class="callout" style="--c:${color}">North of Nakusp, the main road to Revelstoke and the Trans-Canada runs over the Upper Arrow Lake ferry: plan trips around its sailings. From the south end, Castlegar puts the airport, Trail’s regional hospital and Highway 3 within easy reach.</div>
        <p class="note">OSRM estimates for free-flowing traffic, crossing on the ferries where they’re the fastest way. They don’t include waiting for a sailing, mountain-pass weather or winter driving. Check BC’s inland ferry schedules and DriveBC before you travel. Trail is the regional hospital; Kelowna is the nearest large city.</p>
        ${sourceLine(`${D!.source}; ferry routes and airports from ${O!.source}`)}`);
      el.querySelector('tbody')!.addEventListener('click', (e) => {
        const tr = (e.target as HTMLElement).closest('tr');
        if (tr) window.dispatchEvent(new CustomEvent('atlas:place', { detail: tr.dataset.key }));
      });
      return { update() {} };
    },
    tooltip(info) {
      const id = info.layer?.id ?? '';
      const o: any = info.object;
      if (!o || !id.startsWith('access')) return null;
      if (id === 'access-ferry') return `<b>${esc(o.name)}</b><br><span class="tk">Free inland ferry · ${o.km} km crossing</span>`;
      if (id === 'access-airports') return `<b>${esc(o[3] ?? 'Airfield')}</b><br><span class="tk">Airport or airstrip</span>`;
      if (o.p) return `<b>${esc(o.p.name)}</b><br><span class="tk">To the airport</span> <span class="tv">${o.v} min</span><br><span class="tk">Click for place report</span>`;
      return null;
    },
  };
  return l;
}

// ---------------------------------------------------------------------------------------------

/** Curated events that aren’t derivable from the datasets. */
export const CURATED_EVENTS: AtlasEvent[] = [
  { t: 1964.71, layer: '*', title: '1964: the Columbia River Treaty', body: 'Canada and the United States ratify the treaty. Canada agrees to build three storage dams on the Columbia, one of them at the foot of the Arrow Lakes.', lon: -117.77, lat: 49.34, zoom: 9 },
  { t: 1968.78, layer: '*', title: '1968: Hugh Keenleyside Dam closes', body: 'The dam near Castlegar turns the two Arrow Lakes into one reservoir. Rising water floods farms, orchards and townsites along the shore; some 2,000 people are moved, and villages such as Renata, Needles, Edgewood, Burton and Arrow Park are flooded or rebuilt higher up.', lon: -117.95, lat: 49.85, zoom: 8.2 },
  { t: 1973.3, layer: '*', title: '1973: Mica Dam completed', body: 'The treaty’s largest dam, far up the Columbia north of Revelstoke, begins storing water that is released through the Arrow Lakes.', lon: -118.2, lat: 50.9, zoom: 7.6 },
  { t: 1984.6, layer: '*', title: '1984: Revelstoke Dam completed', body: 'A hydro dam just upstream of Revelstoke. The Columbia now reaches the Arrow Lakes through two dams’ turbines.', lon: -118.19, lat: 51.05, zoom: 9.5 },
  { t: 2021.31, layer: '*', title: '2021: the Sinixt and the Supreme Court', body: 'In R. v. Desautel, the Supreme Court of Canada rules that the Sinixt, whose homeland includes the Arrow Lakes, hold Aboriginal rights here, though Canada had declared them extinct in 1956.', lon: -117.9, lat: 50.1, zoom: 8 },
];

// ---------------------------------------------------------------------------------------------
// JUST THE LAKES — the plain map the atlas opens on

function baseLayer(data: Data): AtlasLayer {
  const l: AtlasLayer = {
    id: 'base',
    name: 'Just the lakes',
    icon: '◌',
    color: '#4cc9f0',
    range: [1919, NOW],
    static: true,
    period: 'no data overlaid',
    available: true,
    build: () => [],
    spark: () => [],
    events: () => [],
    panel(el) {
      const n = data.places.length;
      el.innerHTML = `${kicker(l, 'Start here')}
        <h2>The Arrow Lakes, plain</h2>
        <p class="lede">A long, narrow lake on the Columbia River between the Monashee and Selkirk mountains, from Revelstoke’s valley in the north to Castlegar in the south. Nothing is overlaid yet: the dots are the ${n} communities in the atlas.</p>
        <div class="callout" style="--c:#ffd166">The Arrow Lakes are the heart of the homeland of the <b>Sinixt</b> (Arrow Lakes) people. Canada declared them extinct in 1956; the Supreme Court of Canada recognized their rights here in 2021.</div>
        <ol class="howto">
          <li><b>Click a community</b> for its report card.</li>
          <li><b>Layer</b> (top left, or press <kbd>L</kbd>) puts one data set on the map. Start with <i>Reservoir levels</i> and press play.</li>
          <li>On a history layer, press <b>▶</b> (or <kbd>Space</kbd>) to play the years.</li>
          <li><b>Place Finder</b> ranks communities by what matters to you.</li>
          <li><b>Data &amp; sources</b> shows where every number comes from.</li>
        </ol>
        <p class="note">Drag to pan, scroll to zoom, right-drag (or Ctrl-drag) to tilt and turn the map.</p>`;
      return { update() {} };
    },
    tooltip: () => null,
  };
  return l;
}

export function buildLayers(data: Data): AtlasLayer[] {
  return [baseLayer(data), waterLayer(data), firesLayer(data), climateLayer(data), quakesLayer(data), populationLayer(data), homesLayer(data), healthLayer(data), accessLayer(data), hikesLayer(data), lifeLayer(data)];
}

export { placeMetrics, monthKey };
