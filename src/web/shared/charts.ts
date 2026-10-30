/* Chart renderer (ADR-0031): draws a validated JSON spec as an accessible SVG
   figure. Nothing here evaluates anything from the spec: text is set as text,
   numbers come through the validator, colours come from CSS classes on the
   design tokens (so dark mode works), and every chart carries its numbers in a
   table behind a disclosure, so colour is never the only signal. */
import {
  parseChartSpec, radarGeometry, pointsAttr, histogramBins, donutArcs, niceMax, funnelWidths,
  type ChartSpec, type Tone,
} from './chart-math.js';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: Array<Node | string>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const kid of kids) e.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  return e;
}

function html(tag: string, cls: string, ...kids: Array<Node | string>): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const kid of kids) e.append(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  return e;
}

function dataTable(head: string[], rows: Array<Array<string | number>>): HTMLElement {
  const t = html('table', 'ch-table');
  t.append(html('thead', '', html('tr', '', ...head.map(c => html('th', '', c)))));
  t.append(html('tbody', '', ...rows.map(r => html('tr', '', ...r.map(c => html('td', '', String(c)))))));
  return html('details', 'ch-data', html('summary', '', 'Show the numbers'), t);
}

function figure(spec: ChartSpec, svg: SVGElement, table: HTMLElement, summary: string): HTMLElement {
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${spec.title}. ${summary}`);
  svg.append(el('title', {}, spec.title));
  return html('figure', `chart chart-${spec.type}`, html('figcaption', 'ch-title', spec.title), svg, table);
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

function radar(spec: Extract<ChartSpec, { type: 'radar' }>): HTMLElement {
  const W = 340, H = 300, cx = W / 2, cy = 150, r = 100;
  const g = radarGeometry(spec.axes.map(a => a.value), spec.max, cx, cy, r);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch-svg' });
  for (const ring of g.ringPaths) svg.append(el('polygon', { points: pointsAttr(ring), class: 'ch-ring' }));
  g.spokes.forEach(([x, y]) => svg.append(el('line', { x1: cx, y1: cy, x2: x, y2: y, class: 'ch-spoke' })));
  svg.append(el('polygon', { points: pointsAttr(g.points), class: 'ch-area' }));
  g.points.forEach(([x, y], i) => svg.append(el('circle', { cx: x, cy: y, r: 4, class: spec.axes[i]!.emphasis ? 'ch-dot ch-dot-strong' : 'ch-dot' }, el('title', {}, `${spec.axes[i]!.label}: ${f1(spec.axes[i]!.value)} of ${spec.max}`))));
  g.labels.forEach(([x, y], i) => {
    const anchor = Math.abs(x - cx) < 8 ? 'middle' : x > cx ? 'start' : 'end';
    const label = spec.axes[i]!.label.length > 22 ? `${spec.axes[i]!.label.slice(0, 21)}…` : spec.axes[i]!.label;
    svg.append(el('text', { x, y: y + 4, 'text-anchor': anchor, class: 'ch-label' }, label));
  });
  const low = spec.axes.reduce((a, b) => (b.value < a.value ? b : a));
  return figure(spec, svg, dataTable(['Axis', `Grade (of ${spec.max})`], spec.axes.map(a => [a.label, f1(a.value)])), `Lowest: ${low.label}, ${f1(low.value)} of ${spec.max}.`);
}

function bars(spec: Extract<ChartSpec, { type: 'bars' }>): HTMLElement {
  const rowH = 38, labelW = 150, W = 420, pad = 8;
  const max = spec.max ?? niceMax(Math.max(...spec.rows.flatMap(r => [r.value, r.target ?? 0])));
  const H = spec.rows.length * rowH + pad * 2;
  const barW = W - labelW - 56;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch-svg' });
  spec.rows.forEach((row, i) => {
    const y = pad + i * rowH;
    const w = Math.max(row.value > 0 ? 2 : 0, (row.value / max) * barW);
    svg.append(el('text', { x: 0, y: y + 22, class: 'ch-label' }, row.label.length > 24 ? `${row.label.slice(0, 23)}…` : row.label));
    svg.append(el('rect', { x: labelW, y: y + 8, width: barW, height: 14, rx: 3, class: 'ch-track' }));
    svg.append(el('rect', { x: labelW, y: y + 8, width: w, height: 14, rx: 3, class: `ch-bar ch-${row.tone ?? 'neutral'}` }, el('title', {}, `${row.label}: ${f1(row.value)}${spec.unit ? ` ${spec.unit}` : ''}`)));
    if (row.target !== undefined) {
      const tx = labelW + Math.min(barW, (row.target / max) * barW);
      svg.append(el('line', { x1: tx, y1: y + 3, x2: tx, y2: y + 27, class: 'ch-target' }, el('title', {}, `Required: ${f1(row.target)}`)));
    }
    svg.append(el('text', { x: W, y: y + 22, 'text-anchor': 'end', class: 'ch-value' }, `${f1(row.value)}${spec.unit ? ` ${spec.unit}` : ''}`));
  });
  const head = spec.rows.some(r => r.target !== undefined) ? ['Item', 'Value', 'Required'] : ['Item', 'Value'];
  const rows = spec.rows.map(r => (head.length === 3 ? [r.label, f1(r.value), r.target === undefined ? '' : f1(r.target)] : [r.label, f1(r.value)]));
  return figure(spec, svg, dataTable(head, rows), spec.rows.map(r => `${r.label} ${f1(r.value)}${r.target !== undefined ? `, required ${f1(r.target)}` : ''}`).join('; ') + '.');
}

function donut(spec: Extract<ChartSpec, { type: 'donut' }>): HTMLElement {
  const W = 340, H = 190, cx = 90, cy = 95, R = 78, inner = 50;
  const total = spec.slices.reduce((a, s) => a + s.value, 0);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch-svg' });
  if (total === 0) svg.append(el('circle', { cx, cy, r: (R + inner) / 2, class: 'ch-track-ring', 'stroke-width': R - inner, fill: 'none' }));
  for (const arc of donutArcs(spec.slices.map(s => s.value), cx, cy, R, inner)) {
    const s = spec.slices[arc.index]!;
    svg.append(el('path', { d: arc.path, class: `ch-slice ch-${s.tone}` }, el('title', {}, `${s.label}: ${s.value}`)));
  }
  if (spec.centre) svg.append(el('text', { x: cx, y: cy + 8, 'text-anchor': 'middle', class: 'ch-centre' }, spec.centre));
  spec.slices.forEach((s, i) => {
    const y = 40 + i * 28;
    svg.append(el('rect', { x: 190, y: y - 11, width: 14, height: 14, rx: 3, class: `ch-bar ch-${s.tone}` }));
    svg.append(el('text', { x: 212, y, class: 'ch-label' }, `${s.label}`));
    svg.append(el('text', { x: W, y, 'text-anchor': 'end', class: 'ch-value' }, String(s.value)));
  });
  return figure(spec, svg, dataTable(['Group', 'Count'], spec.slices.map(s => [s.label, s.value])), spec.slices.map(s => `${s.label} ${s.value}`).join(', ') + '.');
}

function histogram(spec: Extract<ChartSpec, { type: 'histogram' }>): HTMLElement {
  const W = 420, H = 210, left = 30, bottom = 34, top = 14;
  const { bins, max } = histogramBins(spec.values, spec.lo, spec.hi, spec.step);
  const top1 = niceMax(max);
  const plotW = W - left - 8, plotH = H - bottom - top;
  const bw = plotW / bins.length;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch-svg' });
  [0, 0.5, 1].forEach(t => {
    const y = top + plotH * (1 - t);
    svg.append(el('line', { x1: left, y1: y, x2: W - 8, y2: y, class: 'ch-grid' }));
    svg.append(el('text', { x: left - 6, y: y + 4, 'text-anchor': 'end', class: 'ch-axis' }, f1(top1 * t)));
  });
  const cuts = spec.cuts ?? [];
  bins.forEach((b, i) => {
    const h = (b.count / top1) * plotH;
    const mid = (b.from + b.to) / 2;
    const tone: Tone = cuts.length >= 3 ? (mid >= cuts[2]! ? 'good' : mid >= cuts[1]! ? 'neutral' : mid >= cuts[0]! ? 'warn' : 'bad') : 'neutral';
    svg.append(el('rect', { x: left + i * bw + 2, y: top + plotH - h, width: Math.max(1, bw - 4), height: h, rx: 2, class: `ch-bar ch-${tone}` }, el('title', {}, `${f1(b.from)} to ${f1(b.to)}: ${b.count}`)));
    if (b.count > 0) svg.append(el('text', { x: left + i * bw + bw / 2, y: top + plotH - h - 4, 'text-anchor': 'middle', class: 'ch-value' }, String(b.count)));
  });
  for (let i = 0; i <= bins.length; i += Math.max(1, Math.round(bins.length / 8))) {
    svg.append(el('text', { x: left + i * bw, y: H - 14, 'text-anchor': 'middle', class: 'ch-axis' }, f1(spec.lo + i * spec.step)));
  }
  const n = spec.values.length;
  return figure(spec, svg, dataTable(['From', 'To', 'CVs'], bins.map(b => [f1(b.from), f1(b.to), b.count])), `${n} score${n === 1 ? '' : 's'} between ${f1(spec.lo)} and ${f1(spec.hi)}.`);
}

function funnel(spec: Extract<ChartSpec, { type: 'funnel' }>): HTMLElement {
  const W = 420, rowH = 40, pad = 6;
  const H = spec.stages.length * rowH + pad * 2;
  const widths = funnelWidths(spec.stages.map(s => s.value));
  const maxW = W - 150;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch-svg' });
  spec.stages.forEach((s, i) => {
    const y = pad + i * rowH;
    const w = widths[i]! * maxW;
    svg.append(el('text', { x: 0, y: y + 24, class: 'ch-label' }, s.label));
    svg.append(el('rect', { x: 150, y: y + 6, width: Math.max(w, s.value > 0 ? 2 : 0), height: 26, rx: 3, class: `ch-bar ch-${i === spec.stages.length - 1 ? 'good' : 'neutral'}` }, el('title', {}, `${s.label}: ${s.value}`)));
    svg.append(el('text', { x: 150 + Math.max(w, 2) + 8, y: y + 24, class: 'ch-value' }, String(s.value)));
  });
  return figure(spec, svg, dataTable(['Stage', 'CVs'], spec.stages.map(s => [s.label, s.value])), spec.stages.map(s => `${s.label} ${s.value}`).join(', then ') + '.');
}

/* The one entry point. Returns null for a spec that does not validate, so a
   caller can simply skip it. */
export function renderChart(input: unknown): HTMLElement | null {
  const spec = parseChartSpec(input);
  if (!spec) return null;
  switch (spec.type) {
    case 'radar': return radar(spec);
    case 'bars': return bars(spec);
    case 'donut': return donut(spec);
    case 'histogram': return histogram(spec);
    case 'funnel': return funnel(spec);
  }
}

export function chartRow(...charts: Array<HTMLElement | null>): HTMLElement {
  const row = html('div', 'chart-row');
  for (const c of charts) if (c) row.append(c);
  return row;
}
