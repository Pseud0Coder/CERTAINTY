/* ADR-0031: chart specs are validated, and the geometry is plain arithmetic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChartSpec, radarGeometry, histogramBins, donutArcs, niceMax, funnelWidths, polar, pointsAttr } from '../src/web/shared/chart-math.ts';

test('a valid spec is cleaned and an invalid one is refused, never drawn wrongly', () => {
  const radar = parseChartSpec({ type: 'radar', title: 'Axes', max: 5, axes: [{ label: 'A', value: 4 }, { label: 'B', value: 9 }, { label: 'C', value: -2 }] });
  assert.deepEqual(radar && radar.type === 'radar' && radar.axes.map(a => a.value), [4, 5, 0], 'values are clamped to the scale');
  assert.equal(parseChartSpec(null), null);
  assert.equal(parseChartSpec({ type: 'pie', title: 'x' }), null, 'unknown types are refused');
  assert.equal(parseChartSpec({ type: 'radar', title: 'x', max: 5, axes: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] }), null, 'a radar needs three axes');
  assert.equal(parseChartSpec({ type: 'radar', title: 'x', max: 5, axes: [{ label: 'A', value: NaN }, { label: 'B', value: 2 }, { label: 'C', value: 1 }] }), null, 'a non-finite value is refused');
  assert.equal(parseChartSpec({ type: 'bars', title: '', rows: [{ label: 'a', value: 1 }] }), null, 'a chart needs a title');
  assert.equal(parseChartSpec({ type: 'bars', title: 't', rows: [{ label: 'a', value: -1 }] }), null);
  assert.equal(parseChartSpec({ type: 'histogram', title: 't', lo: 0, hi: 5, step: 0.0001, values: [] }), null, 'too many bins is refused');
  assert.equal(parseChartSpec({ type: 'bars', title: 't', rows: Array.from({ length: 21 }, (_, i) => ({ label: `r${i}`, value: 1 })) }), null, 'lists are bounded');
  const bars = parseChartSpec({ type: 'bars', title: 't', rows: [{ label: 'a', value: 1, tone: 'evil' as never }] });
  assert.equal(bars && bars.type === 'bars' && bars.rows[0]!.tone, 'neutral', 'an unknown tone falls back');
  assert.equal(parseChartSpec({ type: 'bars', title: 't<script>', rows: [{ label: 'a', value: 1 }] })!.title, 't<script>', 'text is kept as data, to be set as text and never as markup');
});

test('the radar puts the first axis straight up and scales values to the radius', () => {
  const g = radarGeometry([5, 0, 2.5, 5], 5, 100, 100, 50);
  assert.deepEqual(g.spokes[0], [100, 50], 'axis 1 points up');
  assert.deepEqual(g.points[0], [100, 50], 'a full-scale value reaches the rim');
  assert.deepEqual(g.points[1], [100, 100], 'zero sits at the centre');
  assert.deepEqual(g.points[2], polar(100, 100, 25, -Math.PI / 2 + Math.PI), 'half scale is half the radius');
  assert.equal(g.ringPaths.length, 5);
  assert.equal(pointsAttr([[1, 2], [3, 4]]), '1,2 3,4');
});

test('histogram bins are half open, the top edge is counted, out-of-range values are ignored', () => {
  const { bins, max } = histogramBins([1, 1.4, 1.5, 2, 5, 5.2, 0.5], 1, 5, 1);
  assert.deepEqual(bins.map(b => b.count), [3, 1, 0, 1], '1, 1.4 and 1.5 fall in [1,2); 2 starts [2,3); 5 is the closed top edge; 0.5 and 5.2 are out of range');
  assert.equal(max, 3);
});

test('the donut covers the circle once, skips empty slices and survives a single slice', () => {
  const arcs = donutArcs([1, 0, 3], 50, 50, 40, 25);
  assert.equal(arcs.length, 2);
  assert.ok(Math.abs(arcs.reduce((a, b) => a + b.share, 0) - 1) < 1e-9);
  assert.deepEqual(arcs.map(a => a.index), [0, 2], 'the empty slice is skipped but indices are kept');
  assert.equal(donutArcs([0, 0], 50, 50, 40, 25).length, 0, 'no data, no arcs');
  const one = donutArcs([7], 50, 50, 40, 25);
  assert.equal(one.length, 1);
  assert.ok(!one[0]!.path.includes('NaN'));
});

test('scales and funnels', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(3.2), 5);
  assert.equal(niceMax(11), 20);
  assert.equal(niceMax(0.07), 0.1);
  assert.deepEqual(funnelWidths([50, 25, 0]), [1, 0.5, 0]);
  assert.equal(funnelWidths([100, 1])[1], 0.02, 'a tiny stage stays visible');
  assert.deepEqual(funnelWidths([0, 0]), [0, 0], 'an empty funnel does not divide by zero');
});

test('the renderer never turns spec text into markup or runs anything from it', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/web/shared/charts.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'setAttribute(\'on', 'javascript:']) {
    assert.ok(!code.includes(banned), `charts.ts must not use ${banned}`);
  }
});
