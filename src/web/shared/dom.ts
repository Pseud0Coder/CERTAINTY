/* DOM helpers. The certainty mark is the one memorable device; every
   evidence element pairs a mark with a word. No emoji, no em dashes. */

export function h(tag: string, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'string') { /* unused */ }
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function onClick(el: HTMLElement, fn: () => void): void {
  el.addEventListener('click', fn);
}

import { initTheme, toggleTheme, currentTheme } from './theme.js';

export function themeToggle(): HTMLElement {
  initTheme();
  const b = h('button', { class: 'btn btn-sm', 'aria-label': 'Toggle color scheme', title: 'Toggle light or dark' });
  const paint = () => {
    b.replaceChildren(...sunMoon(currentTheme()));
  };
  paint();
  b.addEventListener('click', () => { toggleTheme(); paint(); });
  return b;
}

function sunMoon(theme: 'light' | 'dark'): Node[] {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (theme === 'light') {
    p.setAttribute('d', 'M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1M8 5.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2');
  } else {
    p.setAttribute('d', 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z');
  }
  svg.append(p);
  return [svg];
}

/* One 12px mark, four states, currentColor. */
export const MARK_WORD = {
  confirmed: 'Confirmed in two sources',
  claimed: 'Claimed, one source only',
  gap: 'Nothing found',
  conflict: 'Sources disagree',
  blocking: 'Blocks submission',
} as const;
export type MarkState = keyof typeof MARK_WORD;

export function mark(state: MarkState): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `mark mark-${state}`);
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (state === 'confirmed') {
    path.setAttribute('d', 'M1.5 1.5h9v9h-9z');
    path.setAttribute('fill', 'currentColor');
  } else if (state === 'claimed') {
    path.setAttribute('d', 'M1.5 1.5h9v9h-9z M1.5 10.5 L10.5 1.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.25');
    const half = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    half.setAttribute('d', 'M1.5 1.5h9v9z');
    half.setAttribute('fill', 'currentColor');
    svg.append(path, half);
    return svg;
  } else if (state === 'gap') {
    path.setAttribute('d', 'M1.5 1.5h9v9h-9z');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.25');
  } else {
    path.setAttribute('d', 'M1.5 1.5h9v9h-9z M2.5 9.5 L9.5 2.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.25');
  }
  svg.append(path);
  return svg;
}

/* Small line glyphs. Stroked with currentColor so they inherit state
   colour from the element they sit in, exactly like the marks above. */
function glyph(d: string, size = 12): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'glyph');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

export function checkGlyph(size = 12): SVGElement {
  return glyph('M3.5 8.5l3 3 6-7', size);
}

/* Replaces the middot that previously stood in for a lock in the nav. */
export function lockGlyph(size = 11): SVGElement {
  const g = glyph('M4.5 7.5V5.5a3.5 3.5 0 0 1 7 0v2', size);
  const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  box.setAttribute('x', '3');
  box.setAttribute('y', '7.5');
  box.setAttribute('width', '10');
  box.setAttribute('height', '6');
  box.setAttribute('rx', '1.5');
  g.append(box);
  return g;
}

/* The brand mark: a checkmark whose tail flows directly into the start of
   an open ring reading as "C", one continuous stroke rather than two
   glyphs placed side by side. It carries the initial and the idea the
   product is named for at once, verification closing the loop into the
   letter. currentColor, so it inherits --accent through .brand-mark same
   as every other glyph here. */
export function brandMark(size = 22): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'brand-mark');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12.5 17.2 L16 20.6 L23.07 7.57 A11 11 0 1 0 23.07 24.43');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/* The one lockup: mark plus wordmark, used everywhere "Certainty" names
   the product (every rail-head, the login card). `large` is the login
   card's bigger size; the rail-head default is smaller. */
export function brandLockup(opts: { large?: boolean } = {}): HTMLElement {
  const el = h('div', { class: opts.large ? 'brand lg' : 'brand' });
  el.append(brandMark(opts.large ? 34 : 22), h('span', { class: 'brand-word' }, 'Certainty'));
  return el;
}

export function stamp(text: string, markState?: MarkState): HTMLElement {
  const s = h('span', { class: 'stamp' });
  if (markState) s.append(mark(markState));
  s.append(document.createTextNode(text));
  return s;
}

export function badge(text: string, markState?: MarkState): HTMLElement {
  const b = h('span', { class: 'badge figures' });
  if (markState) b.append(mark(markState));
  b.append(document.createTextNode(text));
  return b;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string): void {
  let t = document.getElementById('toast');
  if (!t) {
    t = h('div', { id: 'toast', class: 'toast', role: 'status' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.remove('on'), 2400);
}

export function empty(text: string, action?: { label: string; fn: () => void }): HTMLElement {
  const box = h('div', { class: 'empty' });
  const p = h('p', { class: 't-body' }, text);
  box.append(p);
  if (action) box.append(h('div', { class: 'mt-3' },
    (() => { const b = h('button', { class: 'btn btn-primary' }, action.label); b.addEventListener('click', action.fn); return b; })()));
  return box;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

/* Sets a data-driven width. A `style` attribute cannot be used: the server
   sends `style-src 'self'` with no 'unsafe-inline', so the browser ignores
   style attributes entirely and a bar set that way renders empty. Writing
   through CSSOM is not governed by style-src, so the value applies while
   the policy stays strict. */
export function setWidthPct(el: HTMLElement, pct: number): HTMLElement {
  el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  return el;
}

export function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
