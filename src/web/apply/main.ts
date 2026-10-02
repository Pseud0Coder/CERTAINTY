/* The public apply page (ADR-0024). No login: the requisition id in the path
   is the handle, only an open requisition resolves, and only the public
   fields are rendered. Submission creates an application and, when the
   email or phone matches, attaches it to the existing candidate. */
import { h, toast, empty, viewHeader, themeToggle, railHead } from '../shared/dom.js';

interface PublicRequisition {
  id: string; title: string; department: string; location: string; description: string; headcount: number;
  mustHaves: Array<{ id: string; label: string; required: boolean }>;
  minYears: number | null; remoteOk: boolean; workAuthRequired: boolean;
}

const root = document.getElementById('root')!;
const id = location.pathname.slice('/apply/'.length).split('/')[0] ?? '';

async function load(): Promise<void> {
  const res = await fetch(`/api/public/requisitions/${id}`);
  if (!res.ok) { root.append(empty('This role is not open, or the link is no longer valid.')); return; }
  const { requisition } = await res.json() as { requisition: PublicRequisition };
  render(requisition);
}

function render(q: PublicRequisition): void {
  const app = h('div', { class: 'app' });
  const rail = h('aside', { class: 'rail' }, railHead('Candidate'));
  rail.append(h('div', { class: 'nav' }, h('div', { class: 'nav-item' }, 'Apply')));
  const main = h('main', {}, h('header', { class: 'topbar' }, h('div', { class: 'crumbs' }, 'Careers'), themeToggle()),
    h('div', { class: 'content' }));
  const content = main.querySelector('.content') as HTMLElement;
  app.append(rail, main);
  root.replaceChildren(app);

  content.append(viewHeader(q.title, [q.department, q.location, q.remoteOk ? 'Remote friendly' : null].filter(Boolean).join(' · ')));
  const panel = h('section', { class: 'panel mt-6 w-720' });
  if (q.description) panel.append(h('p', { class: 't-body' }, q.description));
  if (q.mustHaves.length) {
    panel.append(h('h2', { class: 't-section mt-6' }, 'What we look for'));
    const list = h('ul', { class: 'mt-3' });
    for (const m of q.mustHaves) list.append(h('li', { class: 't-body' }, `${m.label}${m.required ? ' (required)' : ''}`));
    panel.append(list);
  }

  const name = h('input', { type: 'text', placeholder: 'Full name' }) as HTMLInputElement;
  const email = h('input', { type: 'email', placeholder: 'Email' }) as HTMLInputElement;
  const phone = h('input', { type: 'tel', placeholder: 'Phone (optional)' }) as HTMLInputElement;
  const employer = h('input', { type: 'text', placeholder: 'Current employer (optional)' }) as HTMLInputElement;
  panel.append(
    h('h2', { class: 't-section mt-6' }, 'Apply'),
    h('div', { class: 'field mt-3' }, h('label', { class: 't-secondary' }, 'Name'), name),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Phone'), phone),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Current employer'), employer));

  const submit = h('button', { class: 'btn btn-primary' }, 'Submit application');
  submit.addEventListener('click', async () => {
    if (!name.value.trim() || !email.value.trim()) { toast('Your name and email are needed.'); return; }
    const res = await fetch(`/api/public/apply/${q.id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.value, email: email.value, phone: phone.value || null, employer: employer.value }),
    });
    const data = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) { toast(data.error === 'already_applied' ? 'You have already applied for this role.' : 'That did not send. Try again.'); return; }
    content.replaceChildren(h('section', { class: 'panel mt-6 w-720' },
      h('h2', { class: 't-section' }, 'Application received'),
      h('p', { class: 't-body mt-3' }, 'Thank you. If your details match, we will attach this to your existing profile, otherwise we create a new one. You will hear from us by email.')));
  });
  panel.append(h('div', { class: 'mt-6' }, submit));
  content.append(panel);
}

void load();
