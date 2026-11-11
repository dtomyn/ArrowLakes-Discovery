// Derived, per-place statistics shared by the Place Report and the Place Finder.
import { CensusRec, Csd, Data, DriveRec, Place, km } from './data';

export type PlaceMetrics = {
  place: Place;
  csd: Csd | null;
  census: CensusRec | null;
  pop: number | null; // latest annual estimate for the place's census subdivision
  popYear: number | null;
  popGrowth10y: number | null; // ratio - 1 over ten years
  drive: DriveRec | null;
  coastKm: number;
  beaches10: number; // mapped beaches within 10 km
  marinas15: number; // marinas and boat launches within 15 km
  outdoors15: number; // trails, viewpoints, parks, waterfalls and hot springs within 15 km
  services10: number; // shops, pharmacies, libraries, schools, cafés and restaurants within 10 km
  nearest: Record<'beach' | 'marina' | 'hotspring' | 'viewpoint', { name: string | null; km: number } | null>;
};

let memo: { data: Data; out: PlaceMetrics[] } | null = null;

export function placeMetrics(data: Data): PlaceMetrics[] {
  if (memo?.data === data) return memo.out;
  const pois = data.osm?.pois ?? [];
  const near = (p: Place, cats: string[], r: number) => pois.filter((q) => cats.includes(q[2]) && km(p.lon, p.lat, q[0], q[1]) <= r).length;
  const nearest = (p: Place, cat: string) => {
    let best: { name: string | null; km: number } | null = null;
    for (const q of pois) if (q[2] === cat) { const d = km(p.lon, p.lat, q[0], q[1]); if (!best || d < best.km) best = { name: q[3], km: d }; }
    return best;
  };
  const trailsNear = (p: Place, r: number) => (data.osm?.trails ?? []).filter((t) => t.parts.some((part) => part.some(([x, y]) => km(p.lon, p.lat, x, y) <= r))).length;

  const out = data.places.map((p) => {
    const series = data.population?.csds[p.csd];
    const ys = series ? Object.keys(series).map(Number).sort((a, b) => a - b) : [];
    const y1 = ys.at(-1) ?? null;
    const pop = y1 != null ? series![y1] : null;
    const past = y1 != null ? series![y1 - 10] : null;
    return {
      place: p,
      csd: data.csds.find((c) => c.csd === p.csd) ?? null,
      census: data.census?.csds[p.csd] ?? null,
      pop, popYear: y1,
      popGrowth10y: pop != null && past ? pop / past - 1 : null,
      drive: data.drive?.places[p.key] ?? null,
      coastKm: p.coastKm,
      beaches10: near(p, ['beach'], 10),
      marinas15: near(p, ['marina'], 15),
      outdoors15: near(p, ['viewpoint', 'nature', 'waterfall', 'hotspring', 'attraction'], 15) + trailsNear(p, 15),
      services10: near(p, ['grocery', 'store', 'pharmacy', 'library', 'school', 'food', 'clinic', 'fuel'], 10),
      nearest: { beach: nearest(p, 'beach'), marina: nearest(p, 'marina'), hotspring: nearest(p, 'hotspring'), viewpoint: nearest(p, 'viewpoint') },
    };
  });
  memo = { data, out };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Place Finder

/** The nearest hospital as mapped in OpenStreetMap (emergency-department hours aren't in open data). */
export const nearestEr = (t: PlaceMetrics) => t.drive?.er[0] ?? null;

export type Criterion = { id: string; label: string; hint: string; value: (t: PlaceMetrics) => number | null; higherIsBetter: boolean; defaultWeight: number };

export const CRITERIA: Criterion[] = [
  { id: 'afford', label: 'Affordability', hint: 'Lower median home value (2021 Census)', value: (t) => t.census?.value ?? null, higherIsBetter: false, defaultWeight: 3 },
  { id: 'er', label: 'Hospital', hint: 'Shorter drive to the nearest hospital', value: (t) => nearestEr(t)?.min ?? null, higherIsBetter: false, defaultWeight: 4 },
  { id: 'grocery', label: 'Groceries', hint: 'Shorter drive to a supermarket', value: (t) => t.drive?.grocery?.min ?? null, higherIsBetter: false, defaultWeight: 3 },
  { id: 'city', label: 'Regional hospital', hint: 'Shorter drive to Kootenay Boundary Regional Hospital in Trail', value: (t) => t.drive?.city?.min ?? null, higherIsBetter: false, defaultWeight: 2 },
  { id: 'airport', label: 'Airport', hint: 'Shorter drive to West Kootenay Regional Airport, Castlegar', value: (t) => t.drive?.airport?.min ?? null, higherIsBetter: false, defaultWeight: 1 },
  { id: 'shore', label: 'Lakeshore', hint: 'Closer to the Arrow Lakes shore', value: (t) => t.coastKm, higherIsBetter: false, defaultWeight: 2 },
  { id: 'beaches', label: 'Beaches & boating', hint: 'Beaches within 10 km and marinas within 15 km', value: (t) => t.beaches10 + t.marinas15, higherIsBetter: true, defaultWeight: 2 },
  { id: 'outdoors', label: 'Trails & views', hint: 'Trails, lookouts, parks, falls and hot springs within 15 km', value: (t) => t.outdoors15, higherIsBetter: true, defaultWeight: 2 },
  { id: 'services', label: 'Shops & services', hint: 'Shops, cafés, pharmacies, schools within 10 km', value: (t) => t.services10, higherIsBetter: true, defaultWeight: 2 },
  { id: 'peers', label: 'Fellow retirees', hint: 'Higher share of residents aged 65+', value: (t) => t.census?.s65 ?? null, higherIsBetter: true, defaultWeight: 1 },
  { id: 'growth', label: 'Growing community', hint: 'Population growth over the last 10 years', value: (t) => t.popGrowth10y, higherIsBetter: true, defaultWeight: 1 },
];

export type Ranked = { t: PlaceMetrics; score: number; parts: Record<string, number | null> };

/** Percentile-rank each criterion across places, then a weighted average over criteria with data. */
export function rankPlaces(places: PlaceMetrics[], weights: Record<string, number>): Ranked[] {
  const parts: Record<string, Map<string, number>> = {};
  for (const c of CRITERIA) {
    const vals = places.map((t) => ({ k: t.place.key, v: c.value(t) })).filter((x) => x.v != null) as { k: string; v: number }[];
    vals.sort((a, b) => a.v - b.v);
    const m = new Map<string, number>();
    vals.forEach((x, i) => {
      let lo = i, hi = i;
      while (lo > 0 && vals[lo - 1].v === x.v) lo--;
      while (hi + 1 < vals.length && vals[hi + 1].v === x.v) hi++;
      const r = vals.length > 1 ? (lo + hi) / 2 / (vals.length - 1) : 0.5;
      m.set(x.k, c.higherIsBetter ? r : 1 - r);
    });
    parts[c.id] = m;
  }
  return places
    .map((t) => {
      let sum = 0, wsum = 0;
      const p: Record<string, number | null> = {};
      for (const c of CRITERIA) {
        const s = parts[c.id].get(t.place.key);
        p[c.id] = s ?? null;
        const w = weights[c.id] ?? 0;
        if (s != null && w > 0) { sum += s * w; wsum += w; }
      }
      return { t, score: wsum ? sum / wsum : 0, parts: p };
    })
    .sort((a, b) => b.score - a.score);
}
