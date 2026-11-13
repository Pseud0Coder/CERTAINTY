/* Chart geometry and spec validation (ADR-0031). Pure functions with no DOM,
   so they run under the test runner. The renderer in charts.ts only draws
   what these return. A chart is described by a small JSON spec; anything that
   does not validate is dropped rather than drawn wrongly. */

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export type ChartSpec =
  | { type: 'radar'; title: string; max: number; axes: Array<{ label: string; value: number; emphasis?: boolean }> }
  | { type: 'bars'; title: string; max?: number; unit?: string; rows: Array<{ label: string; value: number; target?: number; note?: string; tone?: Tone }> }
  | { type: 'donut'; title: string; centre?: string; slices: Array<{ label: string; value: number; tone: Tone }> }
  | { type: 'histogram'; title: string; lo: number; hi: number; step: number; values: number[]; cuts?: number[] }
  | { type: 'funnel'; title: string; stages: Array<{ label: string; value: number }> };

const TONES: Tone[] = ['good', 'warn', 'bad', 'neutral'];
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isText = (s: unknown, max = 120): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;

/* Returns a clean spec, or null when the input is not a chart this renderer
   can draw. Every number is finite, every list is bounded. */
export function parseChartSpec(input: unknown): ChartSpec | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as Record<string, any>;
  if (!isText(s.title, 140)) return null;
  switch (s.type) {
    case 'radar': {
      if (!isNum(s.max) || s.max <= 0 || !Array.isArray(s.axes) || s.axes.length < 3 || s.axes.length > 12) return null;
      if (!s.axes.every((a: any) => a && isText(a.label, 60) && isNum(a.value))) return null;
      return { type: 'radar', title: s.title, max: s.max, axes: s.axes.map((a: any) => ({ label: a.label, value: Math.max(0, Math.min(s.max, a.value)), emphasis: !!a.emphasis })) };
    }
    case 'bars': {
      if (!Array.isArray(s.rows) || s.rows.length < 1 || s.rows.length > 20) return null;
      if (!s.rows.every((r: any) => r && isText(r.label, 80) && isNum(r.value) && r.value >= 0 && (r.target === undefined || (isNum(r.target) && r.target >= 0)))) return null;
      return {
        type: 'bars', title: s.title, max: isNum(s.max) && s.max > 0 ? s.max : undefined, unit: typeof s.unit === 'string' ? s.unit.slice(0, 12) : undefined,
        rows: s.rows.map((r: any) => ({ label: r.label, value: r.value, target: r.target, note: typeof r.note === 'string' ? r.note.slice(0, 80) : undefined, tone: TONES.includes(r.tone) ? r.tone : 'neutral' })),
      };
    }
    case 'donut': {
      if (!Array.isArray(s.slices) || s.slices.length < 1 || s.slices.length > 8) return null;
      if (!s.slices.every((x: any) => x && isText(x.label, 60) && isNum(x.value) && x.value >= 0)) return null;
      return { type: 'donut', title: s.title, centre: typeof s.centre === 'string' ? s.centre.slice(0, 16) : undefined, slices: s.slices.map((x: any) => ({ label: x.label, value: x.value, tone: TONES.includes(x.tone) ? x.tone : 'neutral' })) };
    }
    case 'histogram': {
      if (!isNum(s.lo) || !isNum(s.hi) || !isNum(s.step) || s.step <= 0 || s.hi <= s.lo || (s.hi - s.lo) / s.step > 40) return null;
      if (!Array.isArray(s.values) || s.values.length > 5000 || !s.values.every(isNum)) return null;
      return { type: 'histogram', title: s.title, lo: s.lo, hi: s.hi, step: s.step, values: s.values, cuts: Array.isArray(s.cuts) ? s.cuts.filter(isNum).slice(0, 6) : undefined };
    }
    case 'funnel': {
      if (!Array.isArray(s.stages) || s.stages.length < 2 || s.stages.length > 8) return null;
      if (!s.stages.every((x: any) => x && isText(x.label, 60) && isNum(x.value) && x.value >= 0)) return null;
      return { type: 'funnel', title: s.title, stages: s.stages.map((x: any) => ({ label: x.label, value: x.value })) };
    }
    default: return null;
  }
}

export function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [Math.round((cx + r * Math.cos(angle)) * 100) / 100, Math.round((cy + r * Math.sin(angle)) * 100) / 100];
}

/* Radar: the first axis points straight up and the rest follow clockwise. */
export function radarGeometry(values: number[], max: number, cx: number, cy: number, r: number, rings = 5) {
  const n = values.length;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const spokes = values.map((_, i) => polar(cx, cy, r, angle(i)));
  const labels = values.map((_, i) => polar(cx, cy, r + 18, angle(i)));
  const points = values.map((v, i) => polar(cx, cy, (r * Math.max(0, Math.min(max, v))) / max, angle(i)));
  const ringPaths = Array.from({ length: rings }, (_, k) => {
    const rr = (r * (k + 1)) / rings;
    return values.map((_, i) => polar(cx, cy, rr, angle(i)));
  });
  return { spokes, labels, points, ringPaths };
}

export function pointsAttr(pts: Array<[number, number]>): string { return pts.map(p => p.join(',')).join(' '); }

/* Histogram bins [from, to) with the last bin closed, so `hi` is counted. */
export function histogramBins(values: number[], lo: number, hi: number, step: number) {
  const n = Math.max(1, Math.round((hi - lo) / step));
  const bins = Array.from({ length: n }, (_, i) => ({ from: Math.round((lo + i * step) * 1000) / 1000, to: Math.round((lo + (i + 1) * step) * 1000) / 1000, count: 0 }));
  for (const v of values) {
    if (v < lo || v > hi) continue;
    const i = Math.min(n - 1, Math.floor((v - lo) / step));
    bins[i]!.count++;
  }
  return { bins, max: Math.max(1, ...bins.map(b => b.count)) };
}

/* Donut slices as SVG arc paths. A single full slice is drawn as two halves,
   because an arc cannot start and end on the same point. */
export function donutArcs(values: number[], cx: number, cy: number, r: number, inner: number) {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  let start = -Math.PI / 2;
  const out: Array<{ path: string; share: number; index: number }> = [];
  values.forEach((v, index) => {
    if (v <= 0) return;
    const share = v / total;
    let sweep = share * 2 * Math.PI;
    if (share > 0.9999) sweep = 2 * Math.PI - 0.0001;
    const end = start + sweep;
    const [x1, y1] = polar(cx, cy, r, start), [x2, y2] = polar(cx, cy, r, end);
    const [x3, y3] = polar(cx, cy, inner, end), [x4, y4] = polar(cx, cy, inner, start);
    const large = sweep > Math.PI ? 1 : 0;
    out.push({ index, share, path: `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z` });
    start = end;
  });
  return out;
}

/* A round maximum for an axis, so bars do not end on an odd number. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/* Funnel bar widths as a share of the first stage, never below a visible sliver. */
export function funnelWidths(values: number[]): number[] {
  const top = Math.max(1, values[0] ?? 1);
  return values.map(v => (v <= 0 ? 0 : Math.max(0.02, Math.min(1, v / top))));
}
