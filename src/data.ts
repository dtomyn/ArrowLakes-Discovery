// Loads the pre-built JSON files in public/data and shapes them for rendering.

/** A community the atlas compares. `fn`: a First Nation community (reported, but not ranked in the Finder). */
export type Place = {
  key: string; name: string; csd: string; csdName: string; lon: number; lat: number;
  kind: 'city' | 'town' | 'village' | 'hamlet' | 'first-nation'; fn?: boolean; note?: string;
  /** km to the Arrow Lakes shoreline at full pool (0 on the water) */
  coastKm: number;
};
/** A census subdivision: the municipality, unorganized area or reserve whose figures a place uses. */
export type Csd = { csd: string; name: string; short?: string; seat: string; fn?: boolean };

export type CensusRec = {
  pop21: number | null; pop16: number | null; dwellings: number | null; area: number | null; medAge: number | null;
  s65: number | null; income: number | null; owners: number | null; shelter: number | null; value: number | null; avgValue: number | null;
};

/** `reservoir`: the Arrow Lakes Reservoir since 1968, metres above sea level. `natural`: the lakes before the dam, local gauge datum. */
export type WaterStation = { id: string; name: string; lon: number; lat: number; lake: 'reservoir' | 'natural'; months: Record<string, number> };
/** One mapped fire: t (fractional year it started), ha burned, cause (0 lightning, 1 person, 2 unknown), label, centre, perimeter polygons (fires of 5 ha or more). */
export type Fire = { t: number; ha: number; c: 0 | 1 | 2; n: string; x: number; y: number; g: [number, number][][][] };
export type ClimateStation = { id: string; name: string; lon: number; lat: number; baseline: number; temp: Record<string, number>; km: number };
export type NormalsStation = {
  id: string; name: string; lon: number; lat: number; period: string;
  monthly: Record<'tMean' | 'tMax' | 'tMin' | 'precip' | 'snow' | 'wetDays', (number | null)[]>;
  annual: { precip: number | null; snow: number | null; wetDays: number | null; tMean: number | null };
};
/** lon, lat, depth km, magnitude, t (fractional year), place, kind (0 earthquake, 1 mine blast or mining-induced) */
export type Quake = [number, number, number, number, number, string, 0 | 1];
/** lon, lat, category, name */
export type Poi = [number, number, string, string | null];
export type Trail = { name: string; km: number; parts: [number, number][][]; route: boolean };
export type Trip = { name: string; min: number; km: number; lon: number; lat: number; line?: [number, number][] };
/**
 * A walkable route (scripts/trails.mjs): one of the guide's hikes, a route relation, or a named trail.
 * `parts` are the mapped pieces as drawn; `line` is one ordered line through them (for the elevation
 * profile and the 3D flight); `prof` its elevations in metres at even steps over `lineKm`.
 * `level`: 1 easy, 2 moderate, 3 hard. `falls`: indexes into Trails.falls within 600 m.
 */
export type TrailRoute = {
  key: string; guide: string | null; osm: string | null; name: string; km: number; up: number; down: number; hi: number; lo: number; hrs: number; level: 1 | 2 | 3; loop: boolean;
  net: string | null; op: string | null; web: string | null; wiki: string | null; desc: string | null;
  parts: [number, number][][]; line: [number, number][]; lineKm: number; prof: number[]; falls: number[];
};
/** A mapped waterfall: drop in m where known, ground elevation, metres to the nearest mapped path, routes within 600 m, a Commons photo file name. */
export type Waterfall = { osm: string; name: string | null; lon: number; lat: number; h: number | null; elev: number; path: number | null; routes: number[]; wiki: string | null; img: string | null };
/** What the pipeline found for a guide stop: its route and waterfall (indexes, -1 for none), a Commons photo, ground elevation. */
export type GuideExtra = { route: number; fall: number; img: string | null; elev: number };
/** Per place: km of footpath within 10 km, waterfalls within 30 km, the nearest falls and routes as [index, km]. */
export type TrailPlace = { km10: number; falls30: number; falls: [number, number][]; routes: [number, number][] };
export type Trails = {
  source: string; netKm: number; netPaths: number;
  routes: TrailRoute[]; falls: Waterfall[]; guide: Record<string, GuideExtra>; places: Record<string, TrailPlace>;
  grid: { west: number; south: number; d: number; nx: number; cells: [number, number][] };
};
/** The whole footpath network (trails-net.json, loaded on demand): each way is [name index or -1, sac 0–3, x0, y0, dx, dy, …] in 1/q degrees from west/south. */
export type TrailNet = { west: number; south: number; q: number; names: string[]; ways: number[][] };
export type DriveRec = { er: Trip[]; grocery: Trip | null; city: Trip | null; airport: Trip | null; kelowna: Trip | null };

export type Data = {
  base: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  places: Place[];
  csds: Csd[];
  population: { source: string; csds: Record<string, Record<string, number>> } | null;
  census: { source: string; csds: Record<string, CensusRec> } | null;
  water: { source: string; datum: string; stations: WaterStation[] } | null;
  fires: { source: string; rows: Fire[] } | null;
  climate: { source: string; baselinePeriod: string; stations: ClimateStation[] } | null;
  normals: { source: string; stations: NormalsStation[] } | null;
  quakes: { source: string; rows: Quake[] } | null;
  osm: {
    source: string; pois: Poi[]; trails: Trail[]; ferry: { name: string; path: [number, number][]; km: number }[];
    hospitals: { name: string; lon: number; lat: number }[];
    city: { name: string; lon: number; lat: number }; airport: { name: string; lon: number; lat: number }; kelowna: { name: string; lon: number; lat: number };
  } | null;
  trails: Trails | null;
  drive: { source: string; hospitals: { name: string; lon: number; lat: number }[]; places: Record<string, DriveRec> } | null;
  manifest: Record<string, { ok: boolean; updated?: string; lastError?: string }>;
};

const base = import.meta.env.BASE_URL;

async function load<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`${base}data/${name}.json`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function loadAll(): Promise<Data> {
  const [baseF, places, population, census, water, fires, climate, normals, quakes, osm, drive, manifest, trails] = await Promise.all([
    load<any>('base'), load<any>('places'), load<any>('population'), load<any>('census'), load<any>('water'), load<any>('fires'),
    load<any>('climate'), load<any>('normals'), load<any>('quakes'), load<any>('osm'), load<any>('drive'), load<any>('manifest'),
    load<Trails>('trails'),
  ]);
  return {
    base: baseF,
    places: places?.places ?? [],
    csds: places?.csds ?? [],
    population, census,
    water: water?.stations?.length ? water : null,
    fires: fires?.rows?.length ? fires : null,
    climate: climate?.stations?.length ? climate : null,
    normals: normals?.stations?.length ? normals : null,
    quakes: quakes?.rows?.length ? quakes : null,
    osm, drive,
    trails: trails?.routes?.length || trails?.falls?.length ? trails : null,
    manifest: manifest ?? {},
  };
}

let netPromise: Promise<TrailNet | null> | null = null;
/** The full footpath network loads the first time the hikes layer is shown. */
export const loadTrailNet = () => (netPromise ??= load<TrailNet>('trails-net'));

// ---------------------------------------------------------------------------------------------
// shared helpers

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function km(aLon: number, aLat: number, bLon: number, bLat: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** First index i with get(arr[i]) >= v, for arrays sorted ascending by get. */
export function lowerBound<T>(arr: T[], v: number, get: (d: T) => number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (get(arr[mid]) < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation inside a sparse {year: value} series; null outside its range. */
export function interpYearly(series: Record<string, number> | undefined, t: number, { hold = 0.999 } = {}): number | null {
  if (!series) return null;
  const y0 = Math.floor(t);
  const a = series[y0];
  const b = series[y0 + 1];
  if (a != null && b != null) return a + (b - a) * (t - y0);
  if (a != null && t - y0 <= hold) return a;
  return null;
}

export const monthKey = (t: number) => {
  const y = Math.floor(t);
  const m = Math.min(11, Math.floor((t - y) * 12));
  return `${y}-${String(m + 1).padStart(2, '0')}`;
};
export const keyToT = (k: string) => +k.slice(0, 4) + (+k.slice(5, 7) - 1) / 12;

/** Value of a monthly "YYYY-MM" series at fractional year t, interpolated to the next month. */
export function interpMonthly(series: Record<string, number> | undefined, t: number): number | null {
  if (!series) return null;
  const a = series[monthKey(t)];
  const b = series[monthKey(t + 1 / 12)];
  const f = (t * 12) % 1;
  if (a != null && b != null) return a + (b - a) * f;
  return a ?? null;
}

export const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-CA'),
  money: (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}K`),
  pct: (v: number, d = 1) => `${(v * 100).toFixed(d)}%`,
  signed: (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`,
  cm: (m: number) => `${m >= 0 ? '+' : '−'}${Math.abs(m * 100).toFixed(0)} cm`,
  date: (t: number) => {
    const d = new Date(Date.UTC(Math.floor(t), 0, 1) + (t % 1) * 365.25 * 864e5);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  },
  month: (t: number) => `${MONTHS[Math.min(11, Math.floor((t % 1) * 12))]} ${Math.floor(t)}`,
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The lakes' shoreline rings (a Polygon's outer ring, or each polygon's outer ring). */
export function coastRings(base: Data['base']): [number, number][][] {
  if (!base) return [];
  const g = base.geometry;
  return (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0])) as [number, number][][];
}

/** Ray-casting point-in-polygon test against the shoreline rings (true on the water). */
export function inRings(rings: [number, number][][], lon: number, lat: number) {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}
