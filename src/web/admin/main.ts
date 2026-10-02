/* Admin app. Flow definitions (read-only in this phase), module
   entitlements, audit viewer, usage and invoice projection. */
import { api, subscribe } from '../shared/api.js';
import { h, stamp, toast, empty, clear, icon, railHead, railFoot, topbar, setCrumbs, setCrumbRoot, viewHeader } from '../shared/dom.js';
import type { IconName } from '../shared/dom.js';

let view = 'audit';
const root = document.getElementById('root')!;
const NAV: Array<{ id: string; label: string; module: string; icon: IconName }> = [
  { id: 'audit', label: 'Audit', module: 'admin', icon: 'audit' },
  { id: 'modules', label: 'Modules', module: 'admin', icon: 'modules' },
  { id: 'usage', label: 'Usage and billing', module: 'billing', icon: 'usage' },
  { id: 'users', label: 'Users', module: 'admin', icon: 'users' },
  { id: 'flows', label: 'Flow builder', module: 'admin', icon: 'flows' },
];
let displayName = 'Admin';

/* Module ids are machine names; the admin reads product names. */
const MODULE_LABEL: Record<string, string> = {
  pipeline: 'Pipeline', screener: 'Interview screener', builder: 'Submission builder', notes: 'Recruiter notes',
  journey: 'Candidate journey', resume_studio: 'Resume studio', linkedin_studio: 'LinkedIn studio',
  practice: 'Interview practice', billing: 'Usage and billing', admin: 'Administration',
};

async function boot(): Promise<void> {
  try {
    const me = await api.get('/api/me');
    if (me.user.role !== 'admin') { location.href = '/app/recruiter'; return; }
    displayName = me.user.displayName;
    setCrumbRoot(me.tenantName);
  } catch { location.href = '/login'; return; }
  renderShell();
  await renderView();
  subscribe(['entitlement.changed', 'flow.complete'], renderView);
}

function renderShell(): void {
  clear(root);
  const app = h('div', { class: 'app' });
  const rail = h('aside', { class: 'rail' }, railHead('Admin'));
  const nav = h('nav', { class: 'nav', 'aria-label': 'Admin' });
  for (const item of NAV) {
    const b = h('button', { class: 'nav-item', 'aria-current': view === item.id ? 'page' : 'false', title: item.label },
      icon(item.icon), h('span', { class: 'lbl' }, item.label));
    b.addEventListener('click', () => { view = item.id; renderShell(); renderView(); });
    nav.append(b);
  }
  rail.append(nav, railFoot(displayName, 'Admin'));
  const main = h('main', {}, topbar(), h('div', { class: 'content', id: 'content' }));
  app.append(rail, main);
  root.append(app);
}

async function renderView(): Promise<void> {
  const content = document.getElementById('content')!;
  clear(content);
  setCrumbs([{ label: NAV.find(n => n.id === view)?.label ?? 'Admin' }]);
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
  content.append(viewHeader('Audit', 'Immutable, append-only, queryable per tenant.'));
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
      h('td', {}, h('span', { class: 'rolechip' }, e.role)),
      h('td', {}, h('span', { class: 't-body' }, humanAction(e.action))),
      /* Targets are opaque identifiers. Monospace makes them scannable and
         comparable; the full value stays available on hover. */
      h('td', { class: 'c-target', title: e.target }, e.target)));
  }
  table.append(tbody);
  content.append(h('div', { class: 'table-scroll mt-6' }, table));
}

async function renderModules(content: HTMLElement): Promise<void> {
  content.append(viewHeader('Modules', 'Entitlements gate the rail, the API and flow access. Disabling never deletes spine data.'));
  const { modules, entitlements } = await api.get('/api/admin/entitlements');
  const panel = h('div', { class: 'panel mt-6 w-520' });
  for (const m of modules as string[]) {
    const ent = (entitlements as Array<{ module: string; enabled: boolean }>).find(e => e.module === m);
    /* A switch, not a button labelled with its own state: "Enabled" on a
       button reads as either the state or the action. */
    const on = !!ent?.enabled;
    const row = h('div', { class: 'srow' },
      h('div', {}, h('div', { class: 't-body' }, MODULE_LABEL[m] ?? m), h('div', { class: 't-caption' }, on ? 'On for this tenant' : 'Off for this tenant')));
    const btn = h('button', { class: 'switch', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': `${MODULE_LABEL[m] ?? m} module` },
      h('span', { class: 'switch-knob', 'aria-hidden': 'true' }));
    btn.addEventListener('click', async () => {
      await api.post('/api/admin/entitlements', { module: m, enabled: !(ent?.enabled ?? false) });
      toast(`${MODULE_LABEL[m] ?? m} turned ${on ? 'off' : 'on'}`);
      await renderView();
    });
    row.append(btn);
    panel.append(row);
  }
  content.append(panel);
}

async function renderUsage(content: HTMLElement): Promise<void> {
  content.append(viewHeader('Usage and billing'));
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
  content.append(viewHeader('Users'));
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
  content.append(viewHeader('Flow builder', 'Flow definitions are versioned and deployed server-side. Prompt text never leaves the server.'));
  const { flows } = await api.get('/api/admin/flows');
  for (const f of flows as Array<{ id: string; version: number; title: string; enabled: boolean; steps: Array<{ id: string; kind: string; agent?: string; description: string }> }>) {
    const panel = h('div', { class: 'panel mt-4' });
    panel.append(h('div', { class: 'panel-head' },
      h('h2', { class: 't-section' }, `${f.title} · v${f.version}`), stamp(f.enabled ? 'Enabled' : 'Disabled')));
    for (const s of f.steps) {
      panel.append(h('div', { class: 'srow' },
        h('span', { class: 't-body' }, `${s.id}${s.agent ? ` · ${s.agent}` : ''}`),
        h('span', { class: 't-caption' }, `${s.kind} · ${s.description}`)));
    }
    content.append(panel);
  }
}

boot();
