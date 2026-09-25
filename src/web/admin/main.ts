/* Admin app. Flow definitions (read-only in this phase), module
   entitlements, audit viewer, usage and invoice projection. */
import { api, subscribe } from '../shared/api.js';
import { h, stamp, toast, empty, clear, themeToggle, brandLockup } from '../shared/dom.js';

let view = 'audit';
const root = document.getElementById('root')!;
const NAV = [
  { id: 'audit', label: 'Audit', module: 'admin' },
  { id: 'modules', label: 'Modules', module: 'admin' },
  { id: 'usage', label: 'Usage and billing', module: 'billing' },
  { id: 'users', label: 'Users', module: 'admin' },
  { id: 'flows', label: 'Flow builder', module: 'admin' },
];

async function boot(): Promise<void> {
  try {
    const me = await api.get('/api/me');
    if (me.user.role !== 'admin') { location.href = '/app/recruiter'; return; }
  } catch { location.href = '/login'; return; }
  renderShell();
  await renderView();
  subscribe(['entitlement.changed', 'flow.complete'], renderView);
}

function renderShell(): void {
  clear(root);
  const app = h('div', { class: 'app' });
  const rail = h('aside', { class: 'rail' },
    h('div', { class: 'rail-head' },
      brandLockup(),
      h('div', { class: 't-caption sub' }, 'Admin')));
  const nav = h('nav', { class: 'nav' });
  for (const item of NAV) {
    const b = h('button', { class: 'nav-item', 'aria-current': view === item.id ? 'page' : 'false' },
      h('span', { class: 'lbl' }, item.label));
    b.addEventListener('click', () => { view = item.id; renderShell(); renderView(); });
    nav.append(b);
  }
  rail.append(nav);
  const main = h('main', {},
    h('header', { class: 'topbar' },
      stamp('Admin'), h('span', { class: 'grow' }),
      themeToggle(),
      (() => { const b = h('button', { class: 'btn btn-sm' }, 'Log out'); b.addEventListener('click', async () => { await api.post('/api/auth/logout'); location.href = '/login'; }); return b; })()),
    h('div', { class: 'content', id: 'content' }));
  app.append(rail, main);
  root.append(app);
}

async function renderView(): Promise<void> {
  const content = document.getElementById('content')!;
  clear(content);
  if (view === 'audit') await renderAudit(content);
  else if (view === 'modules') await renderModules(content);
  else if (view === 'usage') await renderUsage(content);
  else if (view === 'users') await renderUsers(content);
  else if (view === 'flows') await renderFlows(content);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Some audit rows record a subject id rather than a display name. Showing a
   full uuid in the actor column crowds out the columns that carry meaning,
   so it is shortened; the full value stays in the title attribute. */
function identityLabel(actor: string): string {
  return UUID.test(actor) ? `${actor.slice(0, 8)}...` : actor;
}

/* The audit stores machine action names. The viewer is read by people. */
function humanAction(action: string): string {
  const words = action.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function renderAudit(content: HTMLElement): Promise<void> {
  content.append(h('h1', { class: 't-view' }, 'Audit'));
  content.append(h('p', { class: 't-secondary' }, 'Immutable, append-only, queryable per tenant.'));
  const { events } = await api.get('/api/admin/audit');
  if (!events.length) { content.append(empty('Nothing yet.')); return; }
  const table = h('table', { class: 'audit' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'When'), h('th', {}, 'Actor'), h('th', {}, 'Role'), h('th', {}, 'Action'), h('th', {}, 'Target'))));
  const tbody = h('tbody', {});
  for (const e of events as Array<{ ts: string; actor: string; role: string; action: string; target: string }>) {
    tbody.append(h('tr', {},
      h('td', { class: 'c-when' }, e.ts.replace('T', ' ').slice(0, 19)),
      h('td', { class: 'c-actor', title: e.actor }, identityLabel(e.actor)),
      h('td', {}, h('span', { class: `rolechip role-${e.role}` }, e.role)),
      h('td', {}, h('span', { class: 't-body' }, humanAction(e.action))),
      /* Targets are opaque identifiers. Monospace makes them scannable and
         comparable; the full value stays available on hover. */
      h('td', { class: 'c-target', title: e.target }, e.target)));
  }
  table.append(tbody);
  content.append(h('div', { class: 'table-scroll' }, table));
}

async function renderModules(content: HTMLElement): Promise<void> {
  content.append(h('h1', { class: 't-view' }, 'Modules'));
  content.append(h('p', { class: 't-secondary' }, 'Entitlements gate the rail, the API and flow access. Disabling never deletes spine data.'));
  const { modules, entitlements } = await api.get('/api/admin/entitlements');
  const panel = h('div', { class: 'panel mt-6 w-520' });
  for (const m of modules as string[]) {
    const ent = (entitlements as Array<{ module: string; enabled: boolean }>).find(e => e.module === m);
    const row = h('div', { class: 'srow' },
      h('span', { class: 't-body' }, m));
    const btn = h('button', { class: 'btn btn-sm' }, ent?.enabled ? 'Enabled' : 'Disabled');
    btn.setAttribute('aria-pressed', ent?.enabled ? 'true' : 'false');
    btn.addEventListener('click', async () => {
      await api.post('/api/admin/entitlements', { module: m, enabled: !(ent?.enabled ?? false) });
      toast(`${m} ${ent?.enabled ? 'disabled' : 'enabled'}`);
      await renderView();
    });
    row.append(btn);
    panel.append(row);
  }
  content.append(panel);
}

async function renderUsage(content: HTMLElement): Promise<void> {
  content.append(h('h1', { class: 't-view' }, 'Usage and billing'));
  const inv = await api.get('/api/admin/usage');
  const panel = h('div', { class: 'panel mt-6 w-560' });
  for (const s of inv.subscriptions as Array<{ module: string; monthly: number }>) {
    panel.append(h('div', { class: 'srow' },
      h('span', { class: 't-body' }, s.module),
      h('span', { class: 'figures' }, `${s.monthly} / month`)));
  }
  panel.append(h('div', { class: 'srow' }, h('span', { class: 't-section' }, 'Subscription total'),
    h('span', { class: 'figures' }, `${inv.subscriptionTotal}`)));
  for (const m of inv.meters as Array<{ kind: string; quantity: number; amount: number }>) {
    panel.append(h('div', { class: 'srow' },
      h('span', { class: 't-secondary' }, m.kind),
      h('span', { class: 'figures' }, `${Math.round(m.quantity * 100) / 100} = ${m.amount}`)));
  }
  panel.append(h('div', { class: 'srow' }, h('span', { class: 't-section' }, 'Total due'),
    h('span', { class: 'figures' }, `${inv.total} ${inv.currency}`)));
  panel.append(h('p', { class: 't-caption mt-3' }, inv.provider));
  content.append(panel);
}

async function renderUsers(content: HTMLElement): Promise<void> {
  content.append(h('h1', { class: 't-view' }, 'Users'));
  const { users } = await api.get('/api/admin/users');
  const panel = h('div', { class: 'panel mt-6 w-560' });
  if (!users.length) panel.append(empty('No users.'));
  for (const u of users as Array<{ id: string; email: string; role: string; displayName: string }>) {
    panel.append(h('div', { class: 'srow' },
      h('span', { class: 't-body' }, `${u.displayName} · ${u.email}`), stamp(u.role)));
  }
  content.append(panel);
}

async function renderFlows(content: HTMLElement): Promise<void> {
  content.append(h('h1', { class: 't-view' }, 'Flow builder'));
  content.append(h('p', { class: 't-secondary' }, 'Flow definitions are versioned and deployed server-side. Prompt text never leaves the server.'));
  const { flows } = await api.get('/api/admin/flows');
  for (const f of flows as Array<{ id: string; version: number; title: string; enabled: boolean; steps: Array<{ id: string; kind: string; agent?: string; description: string }> }>) {
    const panel = h('div', { class: 'panel mt-4' });
    panel.append(h('h2', { class: 't-section' }, `${f.title} · v${f.version}`), stamp(f.enabled ? 'Enabled' : 'Disabled'));
    for (const s of f.steps) {
      panel.append(h('div', { class: 'srow' },
        h('span', { class: 't-body' }, `${s.id}${s.agent ? ` · ${s.agent}` : ''}`),
        h('span', { class: 't-caption' }, `${s.kind} · ${s.description}`)));
    }
    content.append(panel);
  }
}

boot();
