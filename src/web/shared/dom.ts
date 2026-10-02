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
import { api } from './api.js';

export function themeToggle(): HTMLElement {
  initTheme();
  const b = h('button', { class: 'btn btn-ghost btn-icon' });
  /* The button shows and names the theme it switches to, not the one in
     use: a sun on a light screen read as "it is light", not "go light". */
  const paint = () => {
    const target = currentTheme() === 'dark' ? 'light' : 'dark';
    b.replaceChildren(...sunMoon(target));
    b.setAttribute('aria-label', `Switch to ${target} theme`);
    b.title = `Switch to ${target} theme`;
  };
  paint();
  b.addEventListener('click', () => { toggleTheme(); paint(); });
  return b;
}

function sunMoon(theme: 'light' | 'dark'): Node[] {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
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

/* The line icon set: 16px grid, 1.5px stroke, currentColor. Nav items
   carry one each, because the 720 to 1099 rail collapses to icons only and
   a label-only item there renders as an empty button. */
const ICONS = {
  pipeline: 'M2.5 3h3v10h-3zM6.5 3h3v7h-3zM10.5 3h3v4.5h-3z',
  builder: 'M4 2.5h5L12 5.5v8H4zM9 2.5v3h3M6 8.5h4M6 11h4',
  notes: 'M3 2.5h10v11H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3',
  audit: 'M8 2l5 2v4c0 2.9-2.1 5-5 5.8C5.1 13 3 10.9 3 8V4zM5.8 8l1.5 1.5 3-3',
  modules: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  usage: 'M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5',
  users: 'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM1.5 13.5c.4-2.4 2.2-4 4.5-4s4.1 1.6 4.5 4M10.5 2.7a2.5 2.5 0 0 1 0 4.6M12 9.8c1.3.6 2.2 1.9 2.5 3.7',
  flows: 'M4 2.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM4 5.5v3a3 3 0 0 0 3 3h3.5',
  dashboard: 'M2.5 2.5h4.5v6H2.5zM9 2.5h4.5v3.5H9zM9 8h4.5v5.5H9zM2.5 10.5h4.5v3H2.5z',
  resume: 'M4 2.5h8v11H4zM6 5.5h4M6 8h4M6 10.5h2.5',
  linkedin: 'M2.5 2.5h11v11h-11zM5.2 7.2v3.8M5.2 5v.01M7.8 11V7.2M7.8 9c0-1 .8-1.8 1.8-1.8s1.6.8 1.6 1.8v2',
  portfolios: 'M2.5 5h11v8h-11zM6 5V3h4v2M2.5 8.5h11',
  interview: 'M8 10a2 2 0 0 0 2-2V4a2 2 0 0 0-4 0v4a2 2 0 0 0 2 2zM12 7.5a4 4 0 0 1-8 0M8 11.5v2.5',
  todo: 'M2.5 4.2l1.2 1.2 2.1-2.1M2.5 9.7l1.2 1.2 2.1-2.1M8 4.5h5.5M8 10h5.5',
  logout: 'M6.5 2.5h-3v11h3M10 5l3 3-3 3M13 8H6.5',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1',
  external: 'M9 2.5h4.5V7M13.5 2.5l-6 6M11.5 9.5v4h-9v-9h4',
  plus: 'M8 3v10M3 8h10',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
} as const;
export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 16): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}

/* Initials on a neutral disc. People are identified by name, never by a
   generated colour. */
export function avatar(name: string, size: 'sm' | 'md' | 'lg' = 'sm'): HTMLElement {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
  return h('span', { class: `avatar avatar-${size}`, 'aria-hidden': 'true' }, initials || '?');
}

/* The rail head: the brand lockup plus the workspace the user is in. */
export function railHead(workspace: string): HTMLElement {
  return h('div', { class: 'rail-head' }, brandLockup(), h('div', { class: 't-caption sub' }, workspace));
}

async function logout(): Promise<void> {
  await api.post('/api/auth/logout').catch(() => undefined);
  location.href = '/login';
}

/* The account block. It sits at the foot of the rail on wide screens and
   in the topbar below 720px, where the rail becomes a bottom tab bar;
   CSS shows exactly one of the two. */
export function railFoot(displayName: string, role: string): HTMLElement {
  const out = h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Log out', title: 'Log out' }, icon('logout'));
  out.addEventListener('click', () => { void logout(); });
  return h('div', { class: 'rail-foot' },
    avatar(displayName),
    h('div', { class: 'rail-who' },
      h('div', { class: 'rail-name' }, displayName),
      h('div', { class: 't-caption' }, role)),
    themeToggle(), out);
}

export function topbar(trailing: Node[] = []): HTMLElement {
  const out = h('button', { class: 'btn btn-ghost btn-sm' }, 'Log out');
  out.addEventListener('click', () => { void logout(); });
  return h('header', { class: 'topbar' },
    h('nav', { class: 'crumbs', id: 'crumbs', 'aria-label': 'Breadcrumb' }),
    h('span', { class: 'grow' }),
    ...trailing,
    h('span', { class: 'topbar-account' }, themeToggle(), out));
}

/* The trail starts at the agency the user works in, when known. */
let crumbRoot: string | null = null;
export function setCrumbRoot(name: string | null | undefined): void {
  crumbRoot = name ?? null;
}

/* Breadcrumb trail in the topbar. The last item is the current page. */
export function setCrumbs(trail: Array<{ label: string; onClick?: () => void }>): void {
  const el = document.getElementById('crumbs');
  if (!el) return;
  const items = crumbRoot ? [{ label: crumbRoot }, ...trail] : trail;
  el.replaceChildren();
  items.forEach((item, i) => {
    if (i > 0) el.append(h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'));
    if (item.onClick && i < items.length - 1) {
      const b = h('button', { class: 'crumb' }, item.label);
      b.addEventListener('click', item.onClick);
      el.append(b);
    } else {
      el.append(h('span', { class: 'crumb', 'aria-current': i === items.length - 1 ? 'page' : 'false' }, item.label));
    }
  });
}

/* A page header: title, one supporting line, and trailing actions. */
export function viewHeader(title: string, sub?: string, actions: HTMLElement[] = []): HTMLElement {
  const text = h('div', { class: 'viewhead-text' }, h('h1', { class: 't-view' }, title));
  if (sub) text.append(h('p', { class: 't-secondary' }, sub));
  const head = h('div', { class: 'viewhead' }, text);
  if (actions.length) head.append(h('div', { class: 'viewhead-acts' }, ...actions));
  return head;
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

/* ---------- documents ---------- */

export const DOCUMENT_ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/* Plain-language messages for the server's document refusals. */
export const DOCUMENT_ERRORS: Record<string, string> = {
  document_too_large: 'That file is over 5 MB. Export a smaller PDF and try again.',
  unsupported_format: 'Upload a PDF or a Word (.docx) file.',
  no_text_found: 'We could not find any text in that file. If it is a scan, export the original as a PDF.',
  unreadable_document: 'That file could not be read. Try exporting it again as a PDF.',
  empty_document: 'That file is empty.',
  too_large: 'That file is too large to upload.',
};

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('unreadable_document'));
    reader.readAsDataURL(file);
  });
}

/* One upload, for whichever route (candidate or recruiter) is passed. */
export async function uploadDocument(path: string, kind: 'resume' | 'jd', file: File): Promise<any> {
  if (file.size > 5 * 1024 * 1024) throw new Error('document_too_large');
  return api.post(path, { kind, filename: file.name, dataBase64: await fileToBase64(file) });
}

/* A file picker that looks like a button: a real <input type=file> inside
   a label, so keyboard and screen readers get the native control. */
export function filePicker(label: string, onFile: (file: File) => void, opts: { primary?: boolean } = {}): HTMLElement {
  const input = h('input', { type: 'file', accept: DOCUMENT_ACCEPT, class: 'sr-only' }) as HTMLInputElement;
  input.addEventListener('change', () => { const f = input.files?.[0]; if (f) onFile(f); input.value = ''; });
  return h('label', { class: `btn ${opts.primary ? 'btn-primary' : ''} file-pick` }, input, label);
}

/* ---------- password ---------- */

/* Shown instead of the app when someone else chose the password (a
   recruiter adding a candidate). The server refuses every other route
   until this succeeds. */
export function passwordScreen(root: HTMLElement, displayName: string, onDone: () => void): void {
  clear(root);
  const current = h('input', { type: 'password', id: 'pw-current', autocomplete: 'current-password' }) as HTMLInputElement;
  const next = h('input', { type: 'password', id: 'pw-next', autocomplete: 'new-password' }) as HTMLInputElement;
  const again = h('input', { type: 'password', id: 'pw-again', autocomplete: 'new-password' }) as HTMLInputElement;
  const save = h('button', { class: 'btn btn-primary' }, 'Save password');
  const errors: Record<string, string> = {
    wrong_password: 'The temporary password is not right. Check the one your recruiter sent.',
    password_too_short: 'Use at least 10 characters.',
    password_unchanged: 'Choose a password different from the temporary one.',
  };
  save.addEventListener('click', async () => {
    if (next.value !== again.value) { toast('The two new passwords do not match.'); return; }
    try {
      await api.post('/api/auth/password', { current: current.value, next: next.value });
      toast('Password saved');
      onDone();
    } catch (e) { toast(errors[String((e as Error).message)] ?? 'Could not save the password.'); }
  });
  const panel = h('div', { class: 'panel' },
    h('div', { class: 'login-head' }, brandLockup({ large: true }),
      h('p', { class: 't-secondary login-promise' },
        `Welcome, ${displayName}. Your recruiter set a temporary password. Choose your own to continue; only you will know it.`)),
    h('div', { class: 'field' }, h('label', { for: 'pw-current' }, 'Temporary password'), current),
    h('div', { class: 'field' }, h('label', { for: 'pw-next' }, 'New password'), next,
      h('span', { class: 't-caption' }, 'At least 10 characters.')),
    h('div', { class: 'field' }, h('label', { for: 'pw-again' }, 'New password, again'), again),
    save);
  root.append(h('div', { class: 'login' }, panel));
  current.focus();
}

/* Positions a marker along a track, through CSSOM for the same CSP reason. */
export function setLeftPct(el: HTMLElement, pct: number): HTMLElement {
  el.style.left = `${Math.max(0, Math.min(100, pct))}%`;
  return el;
}

export function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}
