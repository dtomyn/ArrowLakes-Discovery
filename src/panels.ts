import { placeTrailsHTML } from './trails';
// Place Report and Place Finder side panels.
import * as d3 from 'd3';
import { Data, fmt } from './data';
import { lineChart } from './charts';
import { esc } from './html';
import { CRITERIA, PlaceMetrics, placeMetrics, rankPlaces, Ranked } from './metrics';

const STORE_KEY = 'arrow-lakes-atlas:weights';

export function loadWeights(): Record<string, number> {
  const def = Object.fromEntries(CRITERIA.map((c) => [c.id, c.defaultWeight]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (saved && typeof saved === 'object') return { ...def, ...saved };
  } catch { /* storage unavailable */ }
  return def;
}
function saveWeights(w: Record<string, number>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(w)); } catch { /* ignore */ }
}

const metric = (label: string, dot: string, v: string, sub: string) =>
  `<div class="metric"><div class="mk"><span class="dot" style="background:${dot}"></span>${label}</div><div class="mv">${v}</div><div class="ms">${sub}</div></div>`;
const na = '<span style="color:var(--ink-3)">n/a</span>';
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);

// ---------------------------------------------------------------------------------------------

export function renderPlaceReport(el: HTMLElement, data: Data, key: string, opts: { onClose: () => void; rank?: { pos: number; of: number; score: number } }) {
  const t = placeMetrics(data).find((x) => x.place.key === key);
  if (!t) return;
  const p = t.place, c = t.census, d = t.drive;
  const area = t.csd?.short ?? t.csd?.name ?? p.csdName;
  const shared = data.places.filter((x) => x.csd === p.csd).length > 1;
  const areaNote = shared ? `for all of ${esc(area)}` : '';
  const kindLabel = { city: 'City', town: 'Town', village: 'Village', hamlet: 'Hamlet', 'first-nation': 'First Nation' }[p.kind];
  const near = (k: keyof PlaceMetrics['nearest'], what: string) => {
    const n = t.nearest[k];
    return n ? `${n.km < 1 ? 'under 1' : n.km.toFixed(0)} km to ${n.name ? esc(n.name) : `the nearest ${what}`}` : `no ${what} mapped`;
  };

  el.innerHTML = `
    <button class="close-x" aria-label="Close place report">×</button>
    <div class="kicker" style="--c:#ffffff">${kindLabel} · ${esc(area)}</div>
    <h2>${esc(p.name)}</h2>
    ${p.note ? `<div class="callout" style="--c:#4cc9f0">${esc(p.note)}</div>` : ''}
    ${p.fn ? `<div class="callout" style="--c:#ffd166">A First Nation community. Reserve land is held for the Nation and isn’t generally for sale to non-members, so ${esc(p.name)} is left out of the Place Finder. Visitors are welcome at many events, such as summer powwows.</div>` : ''}
    ${opts.rank ? `<p class="lede">Ranks <b>#${opts.rank.pos} of ${opts.rank.of}</b> in your Place Finder (score ${Math.round(opts.rank.score * 100)}).</p>` : ''}
    <h3>People &amp; homes</h3>
    <div class="metric-grid">
      ${metric('Population', '#3ecf8e', t.pop ? fmt.int(t.pop) : na, t.pop ? `${t.popYear} estimate ${areaNote}${t.popGrowth10y != null ? `<br>${fmt.signed(t.popGrowth10y * 100, 0)}% in 10 yrs` : ''}` : '')}
      ${metric('Median age', '#3ecf8e', c?.medAge != null ? `${c.medAge.toFixed(1)}` : na, `${c?.s65 != null ? `${fmt.pct(c.s65, 0)} aged 65+` : ''} · 2021 Census`)}
      ${metric('Median home value', '#b388ff', c?.value ? fmt.money(c.value) : na, c?.value ? `owner estimates, 2021 ${areaNote}` : p.fn ? 'not reported on reserve' : '')}
      ${metric('Household income', '#b388ff', c?.income ? fmt.money(c.income) : na, c?.income ? 'median, 2020' : '')}
    </div>
    <h3>Getting places</h3>
    <div class="metric-grid">
      ${metric('Hospital', '#6c8cff', d?.er[0] ? hm(d.er[0].min) : na, d?.er[0] ? `drive to ${esc(d.er[0].name)} · ${Math.round(d.er[0].km)} km${d.er[1] ? `<br>next: ${esc(d.er[1].name)}, ${hm(d.er[1].min)}` : ''}` : '')}
      ${metric('Groceries', '#ffb35c', d?.grocery ? hm(d.grocery.min) : na, d?.grocery ? `to ${esc(d.grocery.name)}` : '')}
      ${metric('Regional hospital', '#ff8a3d', d?.city ? hm(d.city.min) : na, d?.city ? `${esc(d.city.name)} · ${Math.round(d.city.km)} km` : '')}
      ${metric('Airport', '#ff8a3d', d?.airport ? hm(d.airport.min) : na, d?.airport ? `to ${esc(d.airport.name)}${d.kelowna ? `<br>Kelowna ${hm(d.kelowna.min)}` : ''}` : '')}
    </div>
    <h3>Water &amp; outdoors</h3>
    <div class="metric-grid">
      ${metric('Arrow Lakes shore', '#4cc9f0', t.coastKm < 0.5 ? 'on the shore' : `${t.coastKm.toFixed(1)} km`, 'from the community centre, at full pool')}
      ${metric('Beaches', '#ffd99a', String(t.beaches10), `within 10 km · ${near('beach', 'beach')}`)}
      ${metric('Marinas & launches', '#4cc9f0', String(t.marinas15), `within 15 km`)}
      ${metric('Trails & views', '#34d399', String(t.outdoors15), `within 15 km · ${near('hotspring', 'hot spring')}`)}
    </div>
    ${data.trails ? `<h3>Hikes &amp; waterfalls nearby</h3>${placeTrailsHTML(data, key)}` : ''}
    ${t.pop ? `<h3>Population of ${esc(area)}</h3><div id="pr-pop"></div>` : ''}
    <p class="note">Population, home values and incomes cover the whole census subdivision (${esc(area)}), not just this community. Drive times are router estimates from the community centre. For any specific property, check the regional district’s zoning and floodplain bylaws, BC Hydro’s reservoir flowage and erosion lines, wildfire risk, and well and septic records.</p>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);
  el.querySelectorAll<HTMLElement>('[data-hike-route],[data-hike-fall]').forEach((b) => b.addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('atlas:hike', { detail: b.dataset.hikeRoute != null ? { kind: 'route', i: +b.dataset.hikeRoute } : { kind: 'fall', i: +b.dataset.hikeFall! } }))));

  requestAnimationFrame(() => {
    const s = data.population?.csds[p.csd];
    const box = el.querySelector<HTMLElement>('#pr-pop');
    if (s && box) {
      const vals = Object.entries(s).map(([y, v]) => ({ x: +y, y: v }));
      lineChart(box, { height: 110, xDomain: [vals[0].x, vals.at(-1)!.x], yZero: false, valueFormat: fmt.int, series: [{ key: 'p', label: area, color: '#3ecf8e', values: vals }] });
    }
  });
}

// ---------------------------------------------------------------------------------------------

export const PRESETS: Record<string, { label: string; w: Record<string, number> }> = {
  balanced: { label: 'Balanced', w: Object.fromEntries(CRITERIA.map((c) => [c.id, c.defaultWeight])) },
  retire: { label: 'Retiree comforts', w: { afford: 2, er: 5, grocery: 4, city: 3, airport: 2, shore: 2, beaches: 1, outdoors: 1, services: 4, peers: 3, growth: 1 } },
  water: { label: 'Lakeside life', w: { afford: 2, er: 2, grocery: 1, city: 0, airport: 0, shore: 5, beaches: 5, outdoors: 3, services: 1, peers: 0, growth: 0 } },
  budget: { label: 'On a budget', w: { afford: 5, er: 3, grocery: 3, city: 1, airport: 0, shore: 1, beaches: 1, outdoors: 1, services: 2, peers: 0, growth: 1 } },
  wild: { label: 'Quiet & wild', w: { afford: 2, er: 1, grocery: 0, city: 0, airport: 0, shore: 3, beaches: 2, outdoors: 5, services: 0, peers: 0, growth: 0 } },
};

export function renderFinder(el: HTMLElement, data: Data, weights: Record<string, number>, opts: { onChange: (ranked: Ranked[]) => void; onPick: (key: string) => void; onClose: () => void }) {
  const places = placeMetrics(data).filter((t) => !t.place.fn);
  el.innerHTML = `
    <button class="close-x" aria-label="Close Place Finder">×</button>
    <div class="kicker" style="--c:#a99bff">Place Finder</div>
    <h2>Where on the Arrow Lakes should we live?</h2>
    <p class="lede">Tell the atlas what matters to you. Each of the valley’s ${places.length} cities, villages and hamlets is ranked on every factor, then blended with your weights. Columns on the map show the overall score.</p>
    <div class="chips" style="margin:6px 0 10px">${Object.entries(PRESETS).map(([k, p]) => `<button class="chip" data-preset="${k}">${p.label}</button>`).join('')}</div>
    <div class="weights"></div>
    <h3>Your ranking</h3>
    <ol class="rank-list"></ol>
    <p class="note">Scores are relative (0–100 = worst to best among these communities on your criteria). Missing data is skipped, not penalized. Census figures cover the whole city, village or regional-district area, so hamlets in the same area share them. Your weights are saved in this browser.</p>`;
  el.querySelector('.close-x')!.addEventListener('click', opts.onClose);

  const wEl = el.querySelector('.weights')!;
  for (const c of CRITERIA) {
    const row = document.createElement('label');
    row.className = 'weight';
    row.title = c.hint;
    row.innerHTML = `<span>${c.label}<br><span style="color:var(--ink-3);font-size:11px">${c.hint}</span></span><input type="range" min="0" max="5" step="1" value="${weights[c.id]}" data-id="${c.id}" aria-label="${c.label} weight"><span class="wv">${weights[c.id]}</span>`;
    wEl.appendChild(row);
  }
  const list = el.querySelector('.rank-list')!;
  const refresh = () => {
    const ranked = rankPlaces(places, weights);
    list.innerHTML = ranked
      .map((r, i) => {
        const best = CRITERIA.filter((c) => (weights[c.id] ?? 0) > 0 && (r.parts[c.id] ?? 0) >= 0.8).map((c) => c.label).slice(0, 3);
        return `<li data-key="${esc(r.t.place.key)}"><span class="rk">${i + 1}</span><span><span class="nm">${esc(r.t.place.name)}</span><br><span class="rd">${r.t.census?.value ? fmt.money(r.t.census.value) : '—'} · ${esc(best.join(', ') || r.t.place.csdName)}</span></span><span><div class="bar"><i style="width:${Math.round(r.score * 100)}%"></i></div><div class="bar-v">${Math.round(r.score * 100)}</div></span></li>`;
      })
      .join('');
    opts.onChange(ranked);
  };
  wEl.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    weights[inp.dataset.id!] = +inp.value;
    inp.nextElementSibling!.textContent = inp.value;
    saveWeights(weights);
    refresh();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      Object.assign(weights, PRESETS[b.dataset.preset!].w);
      wEl.querySelectorAll<HTMLInputElement>('input').forEach((i) => { i.value = String(weights[i.dataset.id!]); i.nextElementSibling!.textContent = i.value; });
      saveWeights(weights);
      refresh();
    }),
  );
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest('li');
    if (li) opts.onPick(li.dataset.key!);
  });
  refresh();
}

export { d3 };
