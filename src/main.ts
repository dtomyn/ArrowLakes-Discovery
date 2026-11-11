import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import * as maplibregl from 'maplibre-gl';
// MapLibre 6 loads its worker from a separate module file; let Vite emit it and tell MapLibre where it is.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ColumnLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import * as d3 from 'd3';
import { Data, MONTHS, clamp, loadAll } from './data';
import { AtlasEvent, AtlasLayer, CURATED_EVENTS, Ctx, PanelHandle, buildLayers } from './layers';
import { loadWeights, renderFinder, renderPlaceReport } from './panels';
import { openSources, sourcesOpen } from './sources';
import { Ranked } from './metrics';
import { esc } from './html';
import { bindTrails, go as openHike, stopAll as stopTrails, trailsCinema } from './trails';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const INTRO_FROM = { center: [-118.4, 49.4] as [number, number], zoom: 5.4, pitch: 0, bearing: 0 };
const HOME = { center: [-117.72, 49.98] as [number, number], zoom: 7.75, pitch: 52, bearing: -8 };
// layers that draw their own place columns (so the plain pins hide)
const PLACE_LAYERS = new Set(['population', 'homes']);
// static layers that draw place columns only while focused
const PLACE_WHEN_FOCUSED = new Set(['health', 'access']);
const LAYER_GROUPS: { name: string; ids: string[] }[] = [
  { name: 'Base map', ids: ['base'] },
  { name: 'The lake & the land, through time', ids: ['water', 'fires', 'climate', 'quakes'] },
  { name: 'People & homes', ids: ['population', 'homes'] },
  { name: 'Living here', ids: ['health', 'access', 'hikes', 'life'] },
];

type Mode = 'layer' | 'place' | 'finder';

const state = {
  time: 1990,
  playing: false,
  speed: 2,
  // The layer state is exactly two things, changed only by setLayerOn, focus and clearMap:
  //   visible: the layers switched on, which is what the map draws (any number)
  //   active:  the one layer whose story and timeline are shown, or null
  active: null as string | null,
  timeLayer: 'water',
  visible: new Set<string>(),
  selected: null as string | null,
  hovered: null as string | null,
  mode: 'layer' as Mode,
  ranked: null as Ranked[] | null,
  beacons: [] as { ev: AtlasEvent; born: number }[],
};

let data: Data;
let layers: AtlasLayer[] = [];
let byId: Record<string, AtlasLayer> = {};
let events: AtlasEvent[] = [];
let map: maplibregl.Map;
let overlay: MapboxOverlay;
let panelHandle: PanelHandle | null = null;
let firstLabelLayer: string | undefined;

const ctx = (): Ctx => ({ time: state.time, speed: state.speed, data, selected: state.selected, hovered: state.hovered, focusedId: state.active ?? '', clock: performance.now() });
const activeLayer = (): AtlasLayer | null => (state.active ? byId[state.active] ?? null : null);
/** Layers on the map, in menu order. */
const layersOn = () => layers.filter((l) => state.visible.has(l.id));
const timeLayer = () => byId[state.timeLayer];

// ---------------------------------------------------------------------------------------------
// map

function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    ...INTRO_FROM,
    maxPitch: 75,
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true },
  } as any);
  // deck.gl 9.4's MapLibre adapter still reads map.transform, which MapLibre 6 no longer exposes.
  if ((map as any).transform === undefined) {
    Object.defineProperty(map, 'transform', {
      configurable: true,
      get: () => ({ height: map.getCanvas().clientHeight, elevation: map.getCenterElevation() }),
    });
  }
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

  map.on('load', () => {
    const style = map.getStyle();
    firstLabelLayer = style.layers.find((l) => l.type === 'symbol')?.id;
    const waterLayer = style.layers.find((l) => /water/.test(l.id) && l.type === 'fill')?.id;
    map.addSource('dem', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 12,
      attribution: 'Terrain: Mapzen / AWS Terrain Tiles',
    });
    map.addLayer({
      id: 'hillshade', type: 'hillshade', source: 'dem',
      paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#02040a', 'hillshade-highlight-color': 'rgba(150,175,215,0.22)', 'hillshade-accent-color': '#0b1424', 'hillshade-illumination-direction': 315 },
    }, waterLayer);
    if (data.base) {
      map.addSource('lakes', { type: 'geojson', data: data.base });
      map.addLayer({ id: 'coast-glow', type: 'line', source: 'lakes', paint: { 'line-color': '#4cc9f0', 'line-width': 10, 'line-blur': 10, 'line-opacity': 0.16 } }, firstLabelLayer);
      map.addLayer({ id: 'coast-line', type: 'line', source: 'lakes', paint: { 'line-color': '#8fdcff', 'line-width': 0.8, 'line-opacity': 0.5 } }, firstLabelLayer);
    }
    try {
      (map as any).setSky?.({ 'sky-color': '#060a12', 'horizon-color': '#12233d', 'fog-color': '#060a12', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 });
    } catch { /* older renderers */ }

    overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      pickingRadius: 6,
      onHover,
      onClick,
      getCursor: ({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'),
    } as any);
    map.addControl(overlay as any);
    bindTrails({
      map,
      openPlace,
      setCinema: (on) => { if (on) { setPlaying(false); setMenu(false); $('tooltip').hidden = true; } },
    });

    $('loader').classList.add('done');
    setTimeout(() => map.flyTo({ ...HOME, duration: 4200, curve: 1.6, essential: true }), 300);
  });
}

// ---------------------------------------------------------------------------------------------
// deck layers per frame

function render() {
  if (!overlay) return;
  // flights, orbits and the tour over 3D terrain draw with the map's own layers
  if (trailsCinema()) { overlay.setProps({ layers: [] }); return; }
  const c = ctx();
  const out: Layer[] = [];
  for (const l of layers) {
    if (!l.available || !state.visible.has(l.id)) continue;
    for (const dl of l.build(c)) {
      const flat = /haze|scars|base|trails|hikes-net|hikes-routes|hikes-sel/.test(dl.id);
      out.push(flat && firstLabelLayer ? dl.clone({ beforeId: firstLabelLayer } as any) : dl);
    }
  }

  const anyPlace = [...state.visible].some((id) => (PLACE_LAYERS.has(id) || (PLACE_WHEN_FOCUSED.has(id) && id === state.active)) && byId[id]?.available);
  if (state.mode === 'finder' && state.ranked) {
    const ramp = d3.scaleSequential(d3.interpolateRgb('#2b1f6b', '#7dffc4')).domain([0.2, 0.85]).clamp(true);
    const rk = state.ranked.map((r, i) => ({ ...r, i }));
    const h = (r: Ranked) => 600 + r.score ** 1.6 * 22000;
    out.push(
      new ColumnLayer<any>({
        id: 'finder-cols', data: rk,
        getPosition: (r) => [r.t.place.lon, r.t.place.lat],
        radius: 1100, diskResolution: 32, extruded: true,
        getElevation: h,
        getFillColor: (r) => { const c2 = d3.rgb(ramp(r.score)); return [c2.r, c2.g, c2.b, r.i < 5 ? 250 : 170]; },
        material: { ambient: 0.6, diffuse: 0.6, shininess: 80 },
        pickable: true,
        transitions: { getElevation: { duration: 600, easing: d3.easeCubicOut }, getFillColor: 600 },
        updateTriggers: { getElevation: state.ranked, getFillColor: state.ranked },
      }),
      new TextLayer<any>({
        id: 'finder-labels', data: rk.slice(0, 10),
        getPosition: (r) => [r.t.place.lon, r.t.place.lat, h(r) + 1500],
        getText: (r) => `${r.i + 1} · ${r.t.place.name}`,
        getSize: (r) => (r.i < 3 ? 15 : 12),
        getColor: [240, 244, 252, 255], fontFamily: 'Inter, sans-serif', fontWeight: 700, characterSet: 'auto',
        outlineWidth: 3, outlineColor: [6, 10, 18, 230], fontSettings: { sdf: true },
        getTextAnchor: 'middle', getAlignmentBaseline: 'bottom',
        updateTriggers: { getPosition: state.ranked, getText: state.ranked },
        parameters: { depthCompare: 'always' },
      } as any),
    );
  } else if (!anyPlace) {
    out.push(
      new ScatterplotLayer<any>({
        id: 'places-pins', data: data.places,
        getPosition: (p) => [p.lon, p.lat],
        getRadius: 450, radiusMinPixels: 3.5, radiusMaxPixels: 7,
        getFillColor: (p) => (p.fn ? [255, 209, 102, 225] : [235, 242, 255, 215]),
        stroked: true, getLineColor: [6, 10, 18, 255], lineWidthMinPixels: 1.2,
        pickable: true, parameters: { depthCompare: 'always' },
      } as any),
    );
  }

  if (state.selected) {
    const m = data.places.find((x) => x.key === state.selected);
    if (m) {
      const p = (performance.now() % 1600) / 1600;
      out.push(new ScatterplotLayer<any>({
        id: 'selected-ring', data: [m], getPosition: (d) => [d.lon, d.lat],
        getRadius: 1200 + p * 4000, stroked: true, filled: false, lineWidthMinPixels: 2,
        getLineColor: [255, 255, 255, 255 * (1 - p)], updateTriggers: { getRadius: p, getLineColor: p },
        parameters: { depthCompare: 'always' },
      } as any));
    }
  }

  const now = performance.now();
  state.beacons = state.beacons.filter((b) => now - b.born < 3500);
  if (state.beacons.length)
    out.push(new ScatterplotLayer<any>({
      id: 'beacons', data: state.beacons.flatMap((b) => [0, 0.33, 0.66].map((o) => ({ b, o }))),
      getPosition: (d) => [d.b.ev.lon, d.b.ev.lat],
      getRadius: (d) => { const a = ((now - d.b.born) / 3500 + d.o) % 1; return 1500 + a * 30000; },
      stroked: true, filled: false, lineWidthMinPixels: 2,
      getLineColor: (d) => { const a = ((now - d.b.born) / 3500 + d.o) % 1; return [255, 255, 255, 220 * (1 - a) * (1 - (now - d.b.born) / 3500)]; },
      updateTriggers: { getRadius: now, getLineColor: now },
      parameters: { depthCompare: 'always' },
    } as any));

  overlay.setProps({ layers: out });
}

// ---------------------------------------------------------------------------------------------
// interaction

const placeKeyOf = (info: PickingInfo): string | null => {
  const o: any = info.object;
  if (!o) return null;
  return o.p?.key ?? o.t?.place?.key ?? (info.layer?.id.startsWith('places') ? o.key : null);
};

function onHover(info: PickingInfo) {
  const t = $('tooltip');
  state.hovered = placeKeyOf(info);
  if (!info.object || !info.layer) { t.hidden = true; return; }
  let html: string | null = null;
  const id = info.layer.id;
  if (id.startsWith('finder')) {
    const r = info.object as Ranked & { i: number };
    html = `<b>#${r.i + 1} ${esc(r.t.place.name)}</b><br><span class="tk">Score</span> <span class="tv">${Math.round(r.score * 100)}</span><br><span class="tk">Click for place report</span>`;
  } else if (id.startsWith('places')) {
    const p = info.object;
    html = `<b>${esc(p.name)}</b><br><span class="tk">${p.fn ? 'First Nation' : esc(p.csdName)}</span><br><span class="tk">Click for place report</span>`;
  } else {
    const owner = layers.find((l) => id.startsWith(l.id));
    html = owner?.tooltip(info) ?? null;
  }
  if (!html) { t.hidden = true; return; }
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = `${Math.min(info.x, window.innerWidth - r.width - 30)}px`;
  t.style.top = `${Math.min(info.y, window.innerHeight - r.height - 30)}px`;
}

function onClick(info: PickingInfo) {
  if (!info.object) return;
  const owner = info.layer ? layers.find((l) => info.layer!.id.startsWith(l.id)) : null;
  if (owner?.click?.(info)) return;
  const key = placeKeyOf(info);
  if (key) openPlace(key);
  // a click on any other feature opens its layer; every other layer stays on
  else if (owner && owner.id !== state.active) focus(owner.id);
}

function openPlace(key: string) {
  const m = data.places.find((x) => x.key === key);
  if (!m) return;
  state.selected = key;
  const prevMode = state.mode === 'place' ? 'layer' : state.mode;
  state.mode = 'place';
  let rank: { pos: number; of: number; score: number } | undefined;
  if (state.ranked) {
    const i = state.ranked.findIndex((r) => r.t.place.key === key);
    if (i >= 0) rank = { pos: i + 1, of: state.ranked.length, score: state.ranked[i].score };
  }
  swapPanel(() => {
    panelHandle = null;
    renderPlaceReport($('panel'), data, key, {
      rank,
      onClose: () => { state.selected = null; prevMode === 'finder' ? openFinder() : showLayerPanel(); },
    });
  });
  map.flyTo({ center: [m.lon, m.lat], zoom: Math.max(map.getZoom(), 10.2), pitch: 55, duration: 1600, essential: true });
}

function openFinder() {
  stopTrails();
  state.mode = 'finder';
  $('finder-btn').classList.add('active');
  swapPanel(() => {
    panelHandle = null;
    renderFinder($('panel'), data, loadWeights(), {
      onChange: (ranked) => { state.ranked = ranked; },
      onPick: (key) => openPlace(key),
      onClose: () => closeFinder(),
    });
  });
  if (map.getZoom() > 9.5) map.flyTo({ ...HOME, duration: 1400 });
}

function closeFinder() {
  state.mode = 'layer';
  state.ranked = null;
  state.selected = null;
  $('finder-btn').classList.remove('active');
  showLayerPanel();
}

function swapPanel(fill: () => void) {
  const p = $('panel');
  if (state.mode !== 'layer') setPanelOpen(true);
  p.classList.add('swap');
  setTimeout(() => { p.scrollTop = 0; fill(); p.classList.remove('swap'); }, 160);
}

function showLayerPanel() {
  if (state.mode === 'finder') return;
  state.mode = 'layer';
  const a = activeLayer();
  const on = layersOn();
  swapPanel(() => {
    const p = $('panel');
    if (!a && on.length) { panelHandle = null; renderLayersOnPanel(p, on); return; }
    const l = a ?? byId.base;
    p.style.setProperty('--c', l.color);
    panelHandle = l.panel(p, ctx());
    panelHandle.update(ctx());
  });
}

/** Nothing active but layers still on: list them, and a click makes one active. */
function renderLayersOnPanel(p: HTMLElement, on: AtlasLayer[]) {
  p.style.removeProperty('--c');
  p.innerHTML = `<div class="kicker">On the map</div>
    <h2>${on.length} layer${on.length > 1 ? 's' : ''} on</h2>
    <p class="lede">No layer is picked. Pick one to read its story here and get its timeline at the bottom.</p>
    <div class="on-list"></div>
    <p class="note">The others stay on the map. Switch layers on or off in <b>Layer</b> (or press <kbd>L</kbd>).</p>`;
  const list = p.querySelector('.on-list')!;
  for (const l of on) {
    const b = document.createElement('button');
    b.className = 'layer-row';
    b.style.setProperty('--c', l.color);
    b.innerHTML = `<div class="ic">${l.icon}</div><div><div class="nm">${esc(l.name)}</div><div class="rg">${l.static ? 'no timeline' : `${Math.floor(l.range[0])}–${Math.floor(l.range[1])}`}</div></div>`;
    b.addEventListener('click', () => focus(l.id));
    list.appendChild(b);
  }
}

// ---------------------------------------------------------------------------------------------
// layer menu

const menuEl = () => $('layer-menu');
const menuOpen = () => !menuEl().hidden;

function setMenu(open: boolean) {
  menuEl().hidden = !open;
  $('layers-btn').setAttribute('aria-expanded', String(open));
  if (open) (menuEl().querySelector<HTMLElement>('.layer-row.focused') ?? menuEl().querySelector<HTMLElement>('.layer-row'))?.focus({ preventScroll: true });
}

function renderLayerMenu() {
  const a = activeLayer();
  const n = state.visible.size;
  $('picker-ic').textContent = a ? a.icon : n ? '◎' : byId.base.icon;
  $('picker-nm').textContent = a ? a.name : n ? `${n} layer${n > 1 ? 's' : ''} on` : byId.base.name;
  // +N counts the layers on the map other than the active one
  const extra = a ? n - (state.visible.has(a.id) ? 1 : 0) : 0;
  const ex = $('picker-extra');
  ex.hidden = !extra;
  ex.textContent = `+${extra}`;
  ex.title = `${extra} more layer${extra > 1 ? 's' : ''} on the map`;

  const menu = menuEl();
  const listed = new Set(LAYER_GROUPS.flatMap((g) => g.ids));
  menu.innerHTML = '';
  LAYER_GROUPS.forEach((g, gi) => {
    const items = layers.filter((l) => g.ids.includes(l.id) || (gi === LAYER_GROUPS.length - 1 && !listed.has(l.id)));
    if (!items.length) return;
    const sec = document.createElement('div');
    sec.className = 'menu-group';
    sec.innerHTML = `<div class="menu-gh">${g.name}</div>`;
    for (const l of items) {
      const row = document.createElement('div');
      const isBase = l.id === 'base';
      // the base row is the "Clear the map" reset while any layer is on, and highlighted only when the map is empty
      const reset = isBase && n > 0;
      const highlighted = isBase ? n === 0 : l.id === state.active;
      const on = state.visible.has(l.id);
      row.className = `layer-row${highlighted ? ' focused' : ''}${reset ? ' reset' : ''}${l.available ? '' : ' unavailable'}`;
      row.style.setProperty('--c', l.color);
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const [ra, rb] = l.range;
      const nm = reset ? 'Clear the map' : l.name;
      const rg = reset ? 'turn every layer off' : !l.available ? 'data unavailable' : l.static ? l.period ?? 'no timeline' : `${Math.floor(ra)}–${Math.floor(rb)}`;
      row.innerHTML = `<div class="ic">${reset ? '✕' : l.icon}</div><div><div class="nm">${nm}</div><div class="rg">${rg}</div></div>${isBase ? '' : `<button class="eye${on ? ' on' : ''}" data-id="${l.id}" role="switch" aria-checked="${on}" aria-label="${esc(l.name)} on the map" title="${on ? 'Take it off the map' : 'Put it on the map'}"></button>`}`;
      const pick = () => { if (isBase) clearMap(); else focus(l.id); setMenu(false); };
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('eye')) { setLayerOn(l.id, !on); return; }
        pick();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || (e.target as HTMLElement).classList.contains('eye')) return;
        pick();
        $('layers-btn').focus();
      });
      sec.appendChild(row);
    }
    menu.appendChild(sec);
  });
  menu.insertAdjacentHTML('beforeend', `<div class="menu-hint">Flip a switch to put a layer on the map or take it off; any number can be on. Click a layer’s name to read its story and get its timeline. <i>Clear the map</i> turns everything off. Click any community for its report card.</div>`);
}

/** Keep a layer's switch keyboard-focused across the menu re-render that `change` causes. */
function keepSwitchFocus(id: string, change: () => void) {
  const hadFocus = (document.activeElement as HTMLElement | null)?.classList.contains('eye');
  change();
  if (hadFocus) menuEl().querySelector<HTMLElement>(`.eye[data-id="${id}"]`)?.focus();
}

// ---------------------------------------------------------------------------------------------

function setPanelOpen(open: boolean) {
  $('panel').classList.toggle('collapsed', !open);
  document.body.classList.toggle('no-panel', !open);
  const btn = $('panel-btn');
  btn.classList.toggle('on', open);
  btn.setAttribute('aria-pressed', String(open));
  btn.title = open ? 'Hide the story panel (P)' : 'Show the story panel (P)';
  requestAnimationFrame(drawSpark);
  setTimeout(drawSpark, 300);
}

// ---------------------------------------------------------------------------------------------
// layer state: these three functions own every change to state.visible and state.active

/** The on/off switch. The first layer switched on while nothing is active becomes active. */
function setLayerOn(id: string, on: boolean) {
  if (!byId[id] || id === 'base') return;
  keepSwitchFocus(id, () => {
    if (on) {
      state.visible.add(id);
      if (!state.active) focus(id);
      else refreshLayerUI(false);
      return;
    }
    state.visible.delete(id);
    if (id === 'hikes') stopTrails();
    if (state.active === id) { state.active = null; setPlaying(false); }
    // with nothing active the panel lists the layers that are on, so it changes too
    refreshLayerUI(state.active === null);
  });
}

/** Make a layer active (switching it on if it was off), or pass null for none. Never turns other layers off. */
function focus(id: string | null) {
  if (id === 'base') id = null;
  if (id !== null && !byId[id]) return;
  if (id !== 'hikes') stopTrails();
  const changed = state.active !== id;
  if (id === null) {
    state.active = null;
    setPlaying(false);
  } else {
    const l = byId[id];
    state.visible.add(id);
    state.active = id;
    if (changed && !l.static && state.timeLayer !== id) {
      state.timeLayer = id;
      const [a, b] = l.range;
      if (state.time < a || state.time > b) state.time = a;
    }
  }
  if (changed && state.mode !== 'finder') { state.mode = 'layer'; state.selected = null; }
  refreshLayerUI(true);
}

/** The reset row: everything off, nothing active. */
function clearMap() {
  state.visible.clear();
  setPlaying(false);
  stopTrails();
  const changed = state.active !== null;
  state.active = null;
  if (changed && state.mode !== 'finder') { state.mode = 'layer'; state.selected = null; }
  refreshLayerUI(true);
}

/** Redraw the button, menu, timeline and (in layer mode) the side panel from the state. */
function refreshLayerUI(panel: boolean) {
  document.documentElement.style.setProperty('--accent', (activeLayer() ?? byId.base).color);
  renderLayerMenu();
  setupTimeline();
  if (panel && state.mode === 'layer') showLayerPanel();
}

// ---------------------------------------------------------------------------------------------
// timeline

const scrub = () => $<HTMLInputElement>('scrub');

function setupTimeline() {
  const l = timeLayer();
  const f = activeLayer();
  // the timeline belongs to the active layer; with none, or a static one, it steps back behind a note
  const stepBack = !f || !!f.static;
  $('timeline').classList.toggle('static', stepBack);
  const note = $('static-note');
  note.hidden = !stepBack;
  if (!f) {
    note.innerHTML = state.visible.size
      ? `<div>No layer picked</div><span>Click one for its timeline</span>`
      : `<div>No history layer on the map</div><span>Open <b>Layer</b> and pick one, like Reservoir levels, to travel through time</span>`;
  } else if (f.static) {
    const others = layers.filter((x) => !x.static && x.available && state.visible.has(x.id)).map((x) => x.name);
    note.innerHTML = `<div><b>${f.name}</b> doesn’t change over time</div><span>${others.length ? `${others.join(', ')} shown at <i id="static-year">${Math.floor(state.time)}</i> · Space to play` : 'Pick a timeline layer to travel through history'}</span>`;
  }
  const [a, b] = l.range;
  const s = scrub();
  s.min = String(a);
  s.max = String(b);
  s.step = l.monthly ? String(1 / 120) : '0.01';
  $('t-min').textContent = String(Math.floor(a));
  $('t-max').textContent = String(Math.floor(b));
  $('t-label').textContent = l.name;
  drawSpark();
  drawEvents();
}

function drawSpark() {
  const l = timeLayer();
  const cv = $<HTMLCanvasElement>('spark');
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  if (!l.available) return;
  const pts = l.spark();
  if (!pts.length) return;
  const [a, b] = l.range;
  const x = (v: number) => ((v - a) / (b - a)) * w;
  const max = Math.max(...pts.map((p) => Math.abs(p.y))) || 1;
  const diverging = pts.some((p) => p.y < 0);
  const step = l.monthly ? 1 / 12 : 1;
  const bw = Math.max(1, w / ((b - a) / step) - (l.monthly ? 0.3 : 1));
  for (const p of pts) {
    g.fillStyle = p.color ?? l.color;
    g.globalAlpha = p.x <= state.time ? 0.95 : 0.3;
    if (diverging) {
      const mid = h / 2 + 1;
      const hh = (Math.abs(p.y) / max) * (h / 2 - 2);
      g.fillRect(x(p.x), p.y >= 0 ? mid - hh : mid, bw, Math.max(1, hh));
    } else {
      const hh = (p.y / max) * (h - 4);
      g.fillRect(x(p.x), h - hh, bw, Math.max(p.y > 0 ? 1 : 0, hh));
    }
  }
  g.globalAlpha = 1;
}

function drawEvents() {
  const l = timeLayer();
  const [a, b] = l.range;
  const el = $('events');
  el.innerHTML = '';
  for (const ev of events) {
    if (ev.t < a || ev.t > b || (ev.layer !== '*' && ev.layer !== l.id)) continue;
    const d = document.createElement('div');
    d.className = 'ev';
    d.style.left = `${((ev.t - a) / (b - a)) * 100}%`;
    d.style.background = ev.layer === '*' ? '#fff' : byId[ev.layer].color;
    d.title = ev.title;
    d.addEventListener('click', () => {
      setTime(ev.t - 0.02);
      setPlaying(false);
      toast(ev);
      if (ev.lon != null) map.flyTo({ center: [ev.lon, ev.lat!], zoom: ev.zoom ?? 8.5, duration: 1500 });
      setTimeout(() => setTime(ev.t + 0.01), 50);
    });
    el.appendChild(d);
  }
}

function setTime(t: number) {
  const [a, b] = timeLayer().range;
  state.time = clamp(t, a, b);
}

function setPlaying(p: boolean) {
  if (p && !state.active) return; // no layer picked: no timeline to play
  state.playing = p;
  $('play').classList.toggle('playing', p);
  $('play').setAttribute('aria-label', p ? 'Pause' : 'Play');
  if (p) {
    const [a, b] = timeLayer().range;
    if (state.time >= b - 0.01) state.time = a;
  }
}

let lastSparkKey = -1;
function syncTimelineUI() {
  const l = timeLayer();
  const [a, b] = l.range;
  const s = scrub();
  if (document.activeElement !== s || state.playing) s.value = String(state.time);
  s.style.setProperty('--p', `${((state.time - a) / (b - a)) * 100}%`);
  $('year').textContent = String(Math.floor(state.time));
  $('month').textContent = l.monthly || state.speed <= 1 ? MONTHS[Math.min(11, Math.floor((state.time % 1) * 12))] : '';
  const k = Math.floor(state.time * (l.monthly ? 12 : 1));
  if (k !== lastSparkKey) {
    lastSparkKey = k;
    drawSpark();
    const sy = document.getElementById('static-year');
    if (sy) sy.textContent = String(Math.floor(state.time));
  }
}

// ---------------------------------------------------------------------------------------------
// historic event toasts

function toast(ev: AtlasEvent) {
  const stack = $('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--c', ev.layer === '*' ? '#ffffff' : byId[ev.layer]?.color ?? '#fff');
  const yr = Math.floor(ev.t);
  const mo = MONTHS[Math.min(11, Math.floor((ev.t % 1) * 12))];
  for (const [cls, text] of [['td', `${mo} ${yr}`], ['tt', ev.title], ['tb', ev.body]]) {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    el.appendChild(d);
  }
  stack.prepend(el);
  while (stack.children.length > 3) stack.lastElementChild!.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 6500);
  if (ev.lon != null) state.beacons.push({ ev, born: performance.now() });
}

function fireCrossedEvents(prev: number, now: number) {
  if (now <= prev || now - prev > 1.5) return;
  const anyTime = layers.some((l) => !l.static && l.available && state.visible.has(l.id));
  for (const ev of events) if (ev.t > prev && ev.t <= now && (ev.layer === '*' ? anyTime : state.visible.has(ev.layer))) toast(ev);
}

// ---------------------------------------------------------------------------------------------
// main loop

let lastFrame = performance.now();
let lastPanel = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.playing) {
    const prev = state.time;
    const [, b] = timeLayer().range;
    state.time = Math.min(b, state.time + dt * state.speed);
    fireCrossedEvents(prev, state.time);
    if (state.time >= b) setPlaying(false);
  }
  render();
  syncTimelineUI();
  if (panelHandle && now - lastPanel > 90) { lastPanel = now; panelHandle.update(ctx()); }
  requestAnimationFrame(frame);
}

function bindControls() {
  $('play').addEventListener('click', () => setPlaying(!state.playing));
  scrub().addEventListener('input', () => { state.time = +scrub().value; });
  scrub().addEventListener('pointerdown', () => setPlaying(false));
  $<HTMLSelectElement>('speed-sel').addEventListener('change', (e) => { state.speed = +(e.target as HTMLSelectElement).value; });
  $('finder-btn').addEventListener('click', () => (state.mode === 'finder' ? closeFinder() : openFinder()));
  $('about-btn').addEventListener('click', showSources);
  $('layers-btn').addEventListener('click', () => setMenu(!menuOpen()));
  $('panel-btn').addEventListener('click', () => setPanelOpen($('panel').classList.contains('collapsed')));
  document.addEventListener('pointerdown', (e) => { if (menuOpen() && !(e.target as HTMLElement).closest('.layer-picker')) setMenu(false); });
  window.addEventListener('resize', () => drawSpark());
  window.addEventListener('atlas:place', (e) => openPlace((e as CustomEvent).detail));
  // a route or waterfall picked in a Place Report opens on the hikes layer
  window.addEventListener('atlas:hike', (e) => {
    if (!byId.hikes?.available) return;
    if (state.mode === 'finder') closeFinder();
    state.selected = null;
    // choose the view first (and fly there), so the panel opens straight onto its report
    openHike((e as CustomEvent).detail, true, false);
    state.mode = 'layer';
    if (state.active !== 'hikes') focus('hikes');
    else showLayerPanel();
    setPanelOpen(true);
  });
  window.addEventListener('atlas:fit', (e) => {
    const [w, s, ea, n] = (e as CustomEvent).detail as number[];
    map.fitBounds([[w, s], [ea, n]], { padding: { top: 100, bottom: 160, left: 60, right: 440 }, pitch: 50, duration: 1600, maxZoom: 13.5 });
  });
  window.addEventListener('keydown', (e) => {
    if (sourcesOpen() || (e.target as HTMLElement).matches('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
    const step = timeLayer().monthly ? 1 / 12 : 1;
    if (e.key === 'ArrowRight') { setPlaying(false); setTime(Math.floor(state.time / step + 1e-6) * step + step); }
    if (e.key === 'ArrowLeft') { setPlaying(false); setTime(Math.ceil(state.time / step - 1e-6) * step - step); }
    if (e.key === 'Escape') { if (menuOpen()) { setMenu(false); $('layers-btn').focus(); } else $('modal').hidden = true; }
    if (e.key === 'l' || e.key === 'L') setMenu(!menuOpen());
    if (e.key === 'p' || e.key === 'P') setPanelOpen($('panel').classList.contains('collapsed'));
    if (e.key === 's' || e.key === 'S') showSources();
  });
}

function showSources() {
  setPlaying(false);
  setMenu(false);
  openSources(data, { onShow: focus });
}

async function boot() {
  data = await loadAll();
  layers = buildLayers(data);
  byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  events = [...layers.flatMap((l) => (l.available ? l.events() : [])), ...CURATED_EVENTS].sort((a, b) => a.t - b.t);
  state.time = byId.water.range[0];
  initMap();
  bindControls();
  refreshLayerUI(true);
  requestAnimationFrame(frame);
  const hash = location.hash.slice(1);
  if (hash === 'sources') showSources();
  else if (byId[hash]) map.once('load', () => setTimeout(() => focus(hash), 600));
  else if (hash === 'finder') map.once('load', () => setTimeout(openFinder, 600));
  if (new URLSearchParams(location.search).has('film'))
    (window as any).arrowlakes = { map, state, data, layers, focus, openPlace, openFinder, setLayerOn, clearMap, setPlaying, setTime, setPanelOpen, setMenu, showSources, HOME };
}

boot();
