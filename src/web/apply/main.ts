/* The public apply page (ADR-0024, ADR-0026). No login: the requisition id in
   the path is the handle, only an open requisition resolves, and only its
   public fields are rendered (no salary, no approvals, no weights).

   An application needs a CV and an explicit consent; the CV is read on the
   server and becomes the evidence the application is scored on. */
import { h, toast, empty, brandMark, filePicker, fileToBase64, DOCUMENT_ERRORS, themeToggle } from '../shared/dom.js';

interface PublicRequisition {
  id: string; title: string; department: string; location: string; description: string; headcount: number;
  mustHaves: Array<{ id: string; label: string; required: boolean }>;
  minYears: number | null; remoteOk: boolean; workAuthRequired: boolean; client?: string | null;
}

const root = document.getElementById('root')!;
const id = location.pathname.slice('/apply/'.length).split('/')[0] ?? '';

function shell(): HTMLElement {
  const page = h('main', { class: 'apply' });
  root.replaceChildren(
    h('header', { class: 'apply-top' },
      h('span', { class: 'brand' }, brandMark(22), h('span', { class: 'brand-word' }, 'Certainty')),
      h('span', { class: 'grow' }), themeToggle()),
    page);
  return page;
}

async function load(): Promise<void> {
  const page = shell();
  const res = await fetch(`/api/public/requisitions/${encodeURIComponent(id)}`);
  if (!res.ok) { page.append(h('div', { class: 'mt-6' }, empty('This role is not open, or the link is no longer valid.'))); return; }
  const { requisition } = await res.json() as { requisition: PublicRequisition };
  render(page, requisition);
}

function render(page: HTMLElement, q: PublicRequisition): void {
  const where = [q.department, q.location, q.remoteOk ? 'Remote accepted' : null].filter(Boolean).join(' · ');
  const role = h('section', { class: 'panel cert guilloche' },
    h('div', { class: 'cert-in cert-in-2' },
      h('div', { class: 'who' }, h('p', { class: 't-eyebrow' }, 'Open role'), h('h1', { class: 't-display' }, q.title), h('p', {}, where)),
      h('div', {})));
  page.append(role);

  const about = h('section', { class: 'panel mt-6' });
  if (q.description) about.append(h('h2', { class: 't-section' }, 'About the role'), h('p', { class: 't-body prose' }, q.description));
  if (q.mustHaves.length) {
    about.append(h('h2', { class: 't-section mt-6' }, 'What we look for'),
      h('div', { class: 'fit' }, ...q.mustHaves.map(m => h('div', { class: 'fit-row' }, h('span', {}),
        h('div', {}, h('div', { class: 'req' }, m.label)), h('span', { class: 'verdict' }, m.required ? 'Required' : 'Preferred')))));
  }
  if (q.minYears) about.append(h('p', { class: 't-caption mt-3' }, `At least ${q.minYears} years of relevant experience.`));
  page.append(about);

  /* The form. Every field says why it is asked. */
  const name = h('input', { type: 'text', id: 'ap-name', autocomplete: 'name' }) as HTMLInputElement;
  const email = h('input', { type: 'email', id: 'ap-email', autocomplete: 'email' }) as HTMLInputElement;
  const phone = h('input', { type: 'tel', id: 'ap-phone', autocomplete: 'tel' }) as HTMLInputElement;
  let cv: File | null = null;
  const cvName = h('span', { class: 't-caption' }, 'PDF or Word, up to 5 MB');
  const picker = filePicker('Choose your CV', f => { cv = f; cvName.textContent = f.name; });
  const auth = h('select', { id: 'ap-auth' },
    h('option', { value: '' }, 'Choose'), h('option', { value: 'yes' }, 'Yes'), h('option', { value: 'no' }, 'No')) as HTMLSelectElement;
  const consent = h('input', { type: 'checkbox', id: 'ap-consent' }) as HTMLInputElement;
  const form = h('section', { class: 'panel mt-6' },
    h('h2', { class: 't-section' }, 'Apply'),
    h('p', { class: 't-secondary' }, 'Your CV is read to match your experience against this role. A person reviews every application.'),
    h('div', { class: 'form-grid mt-4' },
      h('div', { class: 'field' }, h('label', { for: 'ap-name' }, 'Full name'), name),
      h('div', { class: 'field' }, h('label', { for: 'ap-email' }, 'Email'), email),
      h('div', { class: 'field' }, h('label', { for: 'ap-phone' }, 'Phone (optional)'), phone)),
  );
  /* CV and the one screening question share a row, on the same grid. */
  const second = h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', {}, 'CV'), h('div', { class: 'row gap-3 wrap' }, picker, cvName)));
  if (q.workAuthRequired) {
    second.append(h('div', { class: 'field' }, h('label', { for: 'ap-auth' }, `Authorised to work in ${q.location || 'the role\'s location'}?`), auth));
  }
  form.append(second);
  form.append(h('label', { class: 'chk mt-4' }, consent,
    h('span', {}, 'I agree that my CV and details are processed to assess this application, kept for up to 12 months after the role closes, and that I can ask for them to be deleted.')));

  const submit = h('button', { class: 'btn btn-primary' }, 'Submit application');
  submit.addEventListener('click', async () => {
    if (!name.value.trim() || !email.value.trim()) { toast('Your name and email are needed.'); return; }
    if (!cv) { toast('Attach your CV.'); return; }
    if (q.workAuthRequired && !auth.value) { toast('Answer the work authorisation question.'); return; }
    if (!consent.checked) { toast('Please confirm the consent to continue.'); return; }
    submit.setAttribute('aria-disabled', 'true');
    submit.textContent = 'Sending';
    try {
      const res = await fetch(`/api/public/apply/${q.id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.value, email: email.value, phone: phone.value || null, consent: true,
          filename: cv.name, dataBase64: await fileToBase64(cv), answers: { workAuthorized: auth.value },
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'failed');
      page.replaceChildren(h('section', { class: 'panel cert guilloche mt-6' },
        h('div', { class: 'cert-in cert-in-2' },
          h('div', { class: 'who' }, h('p', { class: 't-eyebrow' }, 'Received'), h('h1', { class: 't-display' }, 'Thank you'),
            h('p', {}, `Your application for ${q.title} is in. A person will review it, and you will hear from us by email.`)),
          h('div', {}))));
    } catch (e) {
      const code = String((e as Error).message);
      const msg: Record<string, string> = {
        already_applied: 'You have already applied for this role.', too_many_attempts: 'Too many attempts. Wait a minute and try again.',
        name_not_found: 'We could not read a name from your CV. Check the name field.', requisition_not_open: 'This role has just closed.',
      };
      toast(msg[code] ?? DOCUMENT_ERRORS[code] ?? 'That did not send. Try again.');
      submit.setAttribute('aria-disabled', 'false');
      submit.textContent = 'Submit application';
    }
  });
  form.append(h('div', { class: 'modal-acts' }, submit));
  page.append(form);
}

void load();
