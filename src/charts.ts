// Small d3 charts for the side panel. Every chart has a hover tooltip and a moving "playhead"
// that tracks the timeline.
import * as d3 from 'd3';

export type ChartHandle = { setPlayhead: (x: number) => void };

const tip = () => document.getElementById('tooltip')!;
function showTip(ev: MouseEvent, html: string) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  const x = Math.min(ev.clientX, window.innerWidth - r.width - 30);
  t.style.left = `${x}px`;
  t.style.top = `${ev.clientY}px`;
}
const hideTip = () => (tip().hidden = true);

type Frame = { svg: d3.Selection<SVGSVGElement, unknown, null, undefined>; w: number; h: number; m: { t: number; r: number; b: number; l: number } };

function frame(el: HTMLElement, height: number, m = { t: 8, r: 8, b: 20, l: 40 }): Frame {
  el.innerHTML = '';
  el.classList.add('chart');
  const width = el.clientWidth || 340;
  const svg = d3.select(el).append('svg').attr('width', width).attr('height', height);
  return { svg, w: width - m.l - m.r, h: height - m.t - m.b, m };
}

function playhead(f: Frame, x: d3.ScaleLinear<number, number>, color: string): ChartHandle {
  const g = f.svg.append('g').attr('transform', `translate(${f.m.l},${f.m.t})`).style('pointer-events', 'none');
  const line = g.append('line').attr('y1', -4).attr('y2', f.h).attr('stroke', color).attr('stroke-width', 1.5).attr('opacity', 0.9);
  const dot = g.append('circle').attr('r', 3).attr('cy', -4).attr('fill', color);
  const [d0, d1] = x.domain();
  return {
    setPlayhead(v: number) {
      const vis = v >= d0 && v <= d1 + 1;
      const px = x(Math.min(v, d1 + 1));
      line.attr('x1', px).attr('x2', px).attr('opacity', vis ? 0.9 : 0);
      dot.attr('cx', px).attr('opacity', vis ? 1 : 0);
    },
  };
}

function axes(f: Frame, x: d3.ScaleLinear<number, number>, y: d3.ScaleLinear<number, number>, yFormat: (v: number) => string, yTicks = 4) {
  const g = f.svg.append('g').attr('transform', `translate(${f.m.l},${f.m.t})`);
  g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(yTicks).tickSize(-f.w).tickFormat(() => '')).call((s) => s.select('.domain').remove());
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${f.h})`)
    .call(d3.axisBottom(x).ticks(Math.min(6, Math.floor(f.w / 55))).tickFormat((v) => String(v)).tickSizeOuter(0));
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(yTicks).tickFormat((v) => yFormat(+v)).tickSize(0).tickPadding(6))
    .call((s) => s.select('.domain').remove());
  return g;
}

// ---------------------------------------------------------------------------------------------

export function barChart(
  el: HTMLElement,
  opts: {
    data: { x: number; y: number; color?: string }[];
    xDomain: [number, number];
    color: string;
    height?: number;
    yFormat?: (v: number) => string;
    tooltip: (d: { x: number; y: number }) => string;
    diverging?: boolean;
  },
): ChartHandle {
  const f = frame(el, opts.height ?? 140);
  const [x0, x1] = opts.xDomain;
  const x = d3.scaleLinear().domain([x0, x1 + 1]).range([0, f.w]);
  const ext = d3.extent(opts.data, (d) => d.y) as [number, number];
  const y = d3.scaleLinear().domain(opts.diverging ? [Math.min(0, ext[0]), Math.max(0, ext[1])] : [0, ext[1] || 1]).nice().range([f.h, 0]);
  const g = axes(f, x, y, opts.yFormat ?? ((v) => d3.format('~s')(v)));
  const bw = Math.max(1, f.w / (x1 - x0 + 1) - 1);
  g.append('g').selectAll('rect').data(opts.data).join('rect')
    .attr('x', (d) => x(d.x) + 0.5).attr('width', bw)
    .attr('y', (d) => y(Math.max(0, d.y))).attr('height', (d) => Math.max(d.y === 0 ? 0 : 1, Math.abs(y(d.y) - y(0))))
    .attr('rx', Math.min(2, bw / 2)).attr('fill', (d) => d.color ?? opts.color);
  if (opts.diverging) g.append('line').attr('x1', 0).attr('x2', f.w).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', 'rgba(255,255,255,.35)');

  const byX = new Map(opts.data.map((d) => [d.x, d]));
  const hover = g.append('rect').attr('width', bw + 1).attr('height', f.h).attr('fill', 'rgba(255,255,255,.08)').attr('opacity', 0).style('pointer-events', 'none');
  g.append('rect').attr('width', f.w).attr('height', f.h).attr('fill', 'transparent')
    .on('mousemove', (ev: MouseEvent) => {
      const xv = Math.floor(x.invert(d3.pointer(ev)[0]));
      const d = byX.get(xv);
      if (!d) { hideTip(); hover.attr('opacity', 0); return; }
      hover.attr('x', x(xv)).attr('opacity', 1);
      showTip(ev, opts.tooltip(d));
    })
    .on('mouseleave', () => { hideTip(); hover.attr('opacity', 0); });
  return playhead(f, x, '#fff');
}

export type LineSeries = { key: string; label: string; color: string; values: { x: number; y: number }[]; width?: number; dashed?: boolean; muted?: boolean };

export function lineChart(
  el: HTMLElement,
  opts: { series: LineSeries[]; xDomain: [number, number]; height?: number; yFormat?: (v: number) => string; yZero?: boolean; valueFormat?: (v: number) => string; tooltipLimit?: number },
): ChartHandle {
  const f = frame(el, opts.height ?? 150);
  const x = d3.scaleLinear().domain(opts.xDomain).range([0, f.w]);
  const all = opts.series.flatMap((s) => s.values.map((v) => v.y));
  const lo = opts.yZero === false ? d3.min(all)! : Math.min(0, d3.min(all) ?? 0);
  const y = d3.scaleLinear().domain([lo, d3.max(all) ?? 1]).nice().range([f.h, 0]);
  const yFmt = opts.yFormat ?? ((v) => d3.format('~s')(v));
  const g = axes(f, x, y, yFmt);
  const line = d3.line<{ x: number; y: number }>().x((d) => x(d.x)).y((d) => y(d.y)).curve(d3.curveMonotoneX);
  // muted series first so highlighted ones sit on top
  const ordered = [...opts.series].sort((a, b) => Number(!a.muted) - Number(!b.muted));
  g.append('g').selectAll('path').data(ordered).join('path')
    .attr('d', (s) => line(s.values))
    .attr('fill', 'none')
    .attr('stroke', (s) => s.color)
    .attr('stroke-width', (s) => s.width ?? 2)
    .attr('stroke-dasharray', (s) => (s.dashed ? '4 3' : null))
    .attr('stroke-linecap', 'round')
    .attr('opacity', (s) => (s.muted ? 0.35 : 1));

  const vf = opts.valueFormat ?? yFmt;
  const cross = g.append('line').attr('y1', 0).attr('y2', f.h).attr('stroke', 'rgba(255,255,255,.4)').attr('opacity', 0).style('pointer-events', 'none');
  const dots = g.append('g').style('pointer-events', 'none');
  g.append('rect').attr('width', f.w).attr('height', f.h).attr('fill', 'transparent')
    .on('mousemove', (ev: MouseEvent) => {
      const xv = x.invert(d3.pointer(ev)[0]);
      const rows: { s: LineSeries; v: { x: number; y: number } }[] = [];
      for (const s of opts.series) {
        if (!s.values.length) continue;
        const i = d3.bisector((d: { x: number }) => d.x).center(s.values, xv);
        const v = s.values[i];
        if (v && Math.abs(v.x - xv) < (opts.xDomain[1] - opts.xDomain[0]) / 20) rows.push({ s, v });
      }
      if (!rows.length) { hideTip(); cross.attr('opacity', 0); dots.selectAll('*').remove(); return; }
      const px = x(rows[0].v.x);
      cross.attr('x1', px).attr('x2', px).attr('opacity', 1);
      const shown = rows.filter((r) => !r.s.muted).sort((a, b) => b.v.y - a.v.y).slice(0, opts.tooltipLimit ?? 6);
      dots.selectAll('circle').data(shown).join('circle').attr('r', 3.5).attr('cx', (r) => x(r.v.x)).attr('cy', (r) => y(r.v.y))
        .attr('fill', (r) => r.s.color).attr('stroke', '#0b1220').attr('stroke-width', 2);
      const label = Number.isInteger(rows[0].v.x) ? rows[0].v.x : `${Math.floor(rows[0].v.x)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.round((rows[0].v.x % 1) * 12) % 12]}`;
      showTip(ev, `<b>${label}</b><br>${shown.map((r) => `<span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${r.s.color};margin-right:6px"></span>${r.s.label} <span class="tv">${vf(r.v.y)}</span>`).join('<br>')}`);
    })
    .on('mouseleave', () => { hideTip(); cross.attr('opacity', 0); dots.selectAll('*').remove(); });
  return playhead(f, x, '#fff');
}

export function scatterChart(
  el: HTMLElement,
  opts: { data: { x: number; y: number; r: number; color: string; label: string }[]; xDomain: [number, number]; yDomain: [number, number]; height?: number; yFormat?: (v: number) => string },
): ChartHandle {
  const f = frame(el, opts.height ?? 150);
  const x = d3.scaleLinear().domain(opts.xDomain).range([0, f.w]);
  const y = d3.scaleLinear().domain(opts.yDomain).range([f.h, 0]);
  const g = axes(f, x, y, opts.yFormat ?? String);
  const sorted = [...opts.data].sort((a, b) => a.r - b.r);
  g.append('g').selectAll('circle').data(sorted).join('circle')
    .attr('cx', (d) => x(d.x)).attr('cy', (d) => y(d.y)).attr('r', (d) => d.r)
    .attr('fill', (d) => d.color).attr('fill-opacity', 0.75).attr('stroke', '#0b1220').attr('stroke-width', 0.6)
    .on('mousemove', (ev: MouseEvent, d) => showTip(ev, d.label))
    .on('mouseleave', hideTip);
  return playhead(f, x, '#fff');
}

/** Horizontal color strip — one cell per year (e.g. warming stripes). */
export function stripes(el: HTMLElement, opts: { cells: { x: number; color: string; label: string }[]; xDomain: [number, number]; height?: number }): ChartHandle {
  const f = frame(el, opts.height ?? 46, { t: 4, r: 8, b: 18, l: 8 });
  const x = d3.scaleLinear().domain([opts.xDomain[0], opts.xDomain[1] + 1]).range([0, f.w]);
  const g = f.svg.append('g').attr('transform', `translate(${f.m.l},${f.m.t})`);
  const bw = f.w / (opts.xDomain[1] - opts.xDomain[0] + 1);
  g.selectAll('rect').data(opts.cells).join('rect')
    .attr('x', (d) => x(d.x)).attr('width', bw + 0.4).attr('height', f.h).attr('fill', (d) => d.color)
    .on('mousemove', (ev: MouseEvent, d) => showTip(ev, d.label)).on('mouseleave', hideTip);
  g.append('g').attr('class', 'axis').attr('transform', `translate(0,${f.h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat((v) => String(v)).tickSizeOuter(0));
  return playhead(f, x, '#fff');
}

export function rampCSS(interp: (t: number) => string, stops = 8) {
  return `linear-gradient(90deg, ${d3.range(stops + 1).map((i) => interp(i / stops)).join(', ')})`;
}
