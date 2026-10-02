/* Requisitions, ranked shortlists, offers, approvals and reports for the
   recruiter and HR surfaces (ADR-0024, ADR-0026). State comes from the API;
   nothing is computed here beyond formatting. Every decision is a form with
   its consequence stated, never a browser prompt. */
import { api } from '../shared/api.js';
import { h, mark, stamp, toast, empty, viewHeader, icon, avatar, setWidthPct, fileToBase64, DOCUMENT_ERRORS, setCrumbs } from '../shared/dom.js';
import type { MarkState } from '../shared/dom.js';

export interface HiringCtx {
  role: string;
  stages: string[];
  hiringModel?: string;
  onChange: () => void;
  onOpen: (id: string) => void;
  onCandidate?: (candidateId: string) => void;
  onNav?: (view: string) => void;
}

interface MustHave { id: string; label: string; weight: number; required: boolean }
interface Requisition {
  id: string; title: string; department: string; location: string; client: string | null;
  status: string; headcount: number; salaryMin: number | null; salaryMax: number | null; currency: string; description: string;
  criteria: { mustHaves: MustHave[]; minYears: number | null; locations: string[]; remoteOk: boolean; workAuthRequired: boolean };
  shortlistAt: number | null; approvals: Array<{ action: string; byName: string; role: string; comment: string; at: string }>;
  createdAt: string;
}
interface Component { mustHaveId: string; label: string; weight: number; required: boolean; status: string; points: number; maxPoints: number; sources: string[] }
interface Knockout { rule: string; label: string; outcome: string; reason: string }
interface Row {
  application: {
    id: string; status: string; stage: string; source: string; createdAt: string;
    score: { total: number; components: Component[]; knockouts: Knockout[]; years: number | null } | null;
    override: { kind: string; delta: number; reason: string; by: string; role: string; at: string } | null;
    dedup: { reason: string } | null;
  };
  effectiveScore: number | null; knockedOut: boolean; excluded: boolean; rank: number | null;
  candidate: { id: string; name: string; email: string | null; years: number | null };
}

const STATUS_MARK: Record<string, MarkState> = {
  open: 'confirmed', pending_approval: 'conflict', approved: 'confirmed', sent: 'claimed',
  accepted: 'confirmed', declined: 'gap', rejected: 'blocking', draft: 'claimed', closed: 'gap', hired: 'confirmed',
};
const EVIDENCE_MARK: Record<string, MarkState> = { verified: 'confirmed', claimed: 'claimed', partial: 'gap', gap: 'blocking' };
const EVIDENCE_WORD: Record<string, string> = { verified: 'Verified', claimed: 'Claimed', partial: 'Partly', gap: 'No evidence' };
const SOURCE_WORD: Record<string, string> = { recruiter: 'Added by recruiter', bulk: 'Bulk CV upload', apply_page: 'Apply page', seed: 'Demo data' };

function word(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '); }
function day(iso: string): string { return iso ? iso.slice(0, 10) : ''; }
function money(n: number): string { return n.toLocaleString('en-GB'); }

/* A modal with a title, a reason for being, fields, and one primary action. */
function modal(title: string, lede: string): { scrim: HTMLElement; box: HTMLElement; close: () => void } {
  const scrim = h('div', { class: 'scrim' });
  const box = h('div', { class: 'modal modal-wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', { class: 't-view' }, title), h('p', { class: 't-secondary' }, lede));
  scrim.append(box);
  const close = () => scrim.remove();
  scrim.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Escape') close(); });
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
  document.body.append(scrim);
  return { scrim, box, close };
}
function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', {}, label), hint ? h('span', { class: 't-caption' }, hint) : '', control);
}
function input(type: string, value = '', placeholder = ''): HTMLInputElement {
  return h('input', { type, value, placeholder }) as HTMLInputElement;
}
function errorText(e: unknown): string {
  const code = String((e as Error).message);
  const map: Record<string, string> = {
    self_approval: 'You submitted this, so someone else has to approve it.', forbidden: 'Your role cannot do that.',
    title_required: 'Give the requisition a title.', salary_band_invalid: 'The salary minimum is above the maximum.',
    reason_required: 'A reason is required.', already_applied: 'Already applied to this requisition.',
    requisition_not_open: 'The requisition is not open.', offer_exists: 'This application already has an offer.',
  };
  return map[code] ?? DOCUMENT_ERRORS[code] ?? 'That did not work. Try again.';
}

/* ---------------------------------------------------------------------- */
/* Requisitions list                                                       */

export async function renderRequisitions(content: HTMLElement, ctx: HiringCtx): Promise<void> {
  const data = await api.get('/api/requisitions') as { requisitions: Array<Requisition & { counts?: Record<string, number> }> };
  const create = h('button', { class: 'btn btn-primary' }, icon('plus'), 'New requisition');
  create.addEventListener('click', () => showRequisitionForm(ctx));
  content.append(viewHeader('Requisitions',
    'A role many candidates apply to. It opens after one approval, and the approver is never the person who submitted it.', [create]));

  if (!data.requisitions.length) {
    content.append(h('div', { class: 'mt-6' }, empty('No requisitions yet. Create one to start a ranked pipeline.', { label: 'New requisition', fn: () => showRequisitionForm(ctx) })));
    return;
  }
  const panel = h('section', { class: 'panel mt-6 req-list' });
  for (const q of data.requisitions) {
    const row = h('button', { class: 'req-row', 'aria-label': `Open ${q.title}` },
      h('div', { class: 'req-main' },
        h('div', { class: 'req-title' }, q.title),
        h('div', { class: 't-caption' }, [q.client, q.department, q.location, `${q.criteria.mustHaves.length} must-haves`].filter(Boolean).join(' · '))),
      stamp(word(q.status), STATUS_MARK[q.status] ?? 'claimed'),
      icon('arrow'));
    row.addEventListener('click', () => ctx.onOpen(q.id));
    panel.append(row);
  }
  content.append(panel);
}

/* Create or edit a draft: the criteria that scoring will apply, stated in
   the form so the recruiter sees the consequence of each setting. */
function showRequisitionForm(ctx: HiringCtx, existing?: Requisition): void {
  const m = modal(existing ? 'Edit requisition' : 'New requisition',
    'Each must-have is scored on evidence: verified counts in full, claimed 70%, partly 35%. A required must-have with no evidence knocks the application out.');
  const q = existing;
  const title = input('text', q?.title ?? '', 'Senior Platform Engineer');
  const department = input('text', q?.department ?? '', 'Platform');
  const location = input('text', q?.location ?? '', 'Dubai');
  const client = input('text', q?.client ?? '', 'The hiring client');
  const headcount = input('number', String(q?.headcount ?? 1));
  const salaryMin = input('number', q?.salaryMin != null ? String(q.salaryMin) : '', 'Minimum');
  const salaryMax = input('number', q?.salaryMax != null ? String(q.salaryMax) : '', 'Maximum');
  const currency = input('text', q?.currency ?? 'AED');
  const minYears = input('number', q?.criteria.minYears != null ? String(q.criteria.minYears) : '', 'None');
  const locations = input('text', (q?.criteria.locations ?? []).join(', '), 'Dubai, Abu Dhabi');
  const remoteOk = h('input', { type: 'checkbox' }) as HTMLInputElement; remoteOk.checked = !!q?.criteria.remoteOk;
  const workAuth = h('input', { type: 'checkbox' }) as HTMLInputElement; workAuth.checked = !!q?.criteria.workAuthRequired;
  const shortlistAt = input('number', q?.shortlistAt != null ? String(q.shortlistAt) : '70');
  const description = h('textarea', { rows: '4', placeholder: 'The job description candidates will see' }) as HTMLTextAreaElement;
  description.value = q?.description ?? '';

  const musts = h('div', { class: 'must-list' });
  const addMust = (mh?: MustHave) => {
    const label = input('text', mh?.label ?? '', 'For example Kubernetes in production');
    const weight = h('select', { 'aria-label': 'Weight' }) as HTMLSelectElement;
    for (const w of [1, 2, 3]) weight.append(h('option', { value: String(w) }, `Weight ${w}`));
    weight.value = String(mh?.weight ?? 1);
    const required = h('input', { type: 'checkbox', 'aria-label': 'Required' }) as HTMLInputElement; required.checked = !!mh?.required;
    const remove = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Remove');
    const line = h('div', { class: 'must-line' }, label, weight, h('label', { class: 'chk-inline' }, required, 'Required'), remove);
    remove.addEventListener('click', () => line.remove());
    musts.append(line);
  };
  (q?.criteria.mustHaves.length ? q.criteria.mustHaves : [undefined, undefined]).forEach(x => addMust(x));
  const more = h('button', { class: 'btn btn-sm', type: 'button' }, icon('plus', 14), 'Add must-have');
  more.addEventListener('click', () => addMust());

  m.box.append(
    h('div', { class: 'form-grid' },
      field('Title', title), field('Department', department), field('Location', location),
      field(ctx.hiringModel === 'agency' ? 'Client' : 'Client (agency only)', client),
      field('Headcount', headcount), field('Currency', currency),
      field('Salary band', h('div', { class: 'row gap-2' }, salaryMin, salaryMax), 'Internal. Never shown to candidates.')),
    field('Description', description),
    h('h3', { class: 't-section mt-4' }, 'Must-haves'), musts, more,
    h('h3', { class: 't-section mt-6' }, 'Knockouts and progression'),
    h('div', { class: 'form-grid' },
      field('Minimum years', minYears, 'Fewer years than this knocks out. Unknown years only flags a check.'),
      field('Accepted locations', locations, 'Comma separated. Leave empty to accept any.'),
      field('Shortlist at score', shortlistAt, 'At or above this, with no knockouts, the application is shortlisted.')),
    h('label', { class: 'chk' }, remoteOk, h('span', {}, 'Remote candidates are accepted wherever they are')),
    h('label', { class: 'chk' }, workAuth, h('span', {}, 'Work authorisation is required (asked on the apply page)')));

  const save = h('button', { class: 'btn btn-primary' }, existing ? 'Save changes' : 'Create draft');
  save.addEventListener('click', async () => {
    const mustHaves = Array.from(musts.querySelectorAll('.must-line')).map((line, i) => {
      const [label, weight] = [line.querySelector('input[type=text]') as HTMLInputElement, line.querySelector('select') as HTMLSelectElement];
      const req = line.querySelector('input[type=checkbox]') as HTMLInputElement;
      return { id: existing?.criteria.mustHaves[i]?.id, label: label.value.trim(), weight: Number(weight.value), required: req.checked };
    }).filter(x => x.label);
    const body = {
      title: title.value, department: department.value, location: location.value, client: client.value || null,
      headcount: Number(headcount.value) || 1, currency: currency.value || 'AED', description: description.value,
      salaryMin: salaryMin.value ? Number(salaryMin.value) : null, salaryMax: salaryMax.value ? Number(salaryMax.value) : null,
      shortlistAt: shortlistAt.value ? Number(shortlistAt.value) : null,
      criteria: {
        mustHaves, minYears: minYears.value ? Number(minYears.value) : null,
        locations: locations.value.split(',').map(x => x.trim()).filter(Boolean), remoteOk: remoteOk.checked, workAuthRequired: workAuth.checked,
      },
    };
    try {
      if (existing) await api.post(`/api/requisitions/${existing.id}/update`, body);
      else await api.post('/api/requisitions', body);
      m.close(); toast(existing ? 'Saved' : 'Requisition drafted'); ctx.onChange();
    } catch (e) { toast(errorText(e)); }
  });
  const cancel = h('button', { class: 'btn' }, 'Cancel');
  cancel.addEventListener('click', m.close);
  m.box.append(h('div', { class: 'modal-acts' }, cancel, save));
  title.focus();
}

/* ---------------------------------------------------------------------- */
/* Requisition detail: certificate header, ranked shortlist, criteria       */

export async function renderRequisitionDetail(content: HTMLElement, id: string, ctx: HiringCtx): Promise<void> {
  const data = await api.get(`/api/requisitions/${id}`) as { requisition: Requisition; rows: Row[]; stages: string[] };
  const q = data.requisition;
  const rows = data.rows;
  setCrumbs([{ label: 'Requisitions', onClick: () => ctx.onNav?.('requisitions') }, { label: q.title }]);
  const shortlisted = rows.filter(r => r.application.status === 'shortlisted').length;
  const knocked = rows.filter(r => r.knockedOut).length;

  /* Header: title, status and the actions this role may take. */
  const acts = h('div', { class: 'cert-acts' });
  const btn = (label: string, primary: boolean, fn: () => Promise<void> | void) => {
    const b = h('button', { class: primary ? 'btn btn-primary' : 'btn' }, label);
    b.addEventListener('click', () => { void fn(); });
    acts.append(b);
  };
  if (q.status === 'draft' || q.status === 'rejected') {
    btn('Edit', false, () => showRequisitionForm(ctx, q));
    btn('Submit for approval', true, async () => {
      try { await api.post(`/api/requisitions/${id}/submit`); toast('Submitted. An approver will review it.'); ctx.onChange(); }
      catch (e) { toast(errorText(e)); }
    });
  }
  if (q.status === 'pending_approval' && ctx.role !== 'recruiter') {
    btn('Request changes', false, () => showDecision(id, 'changes_requested', ctx));
    btn('Reject', false, () => showDecision(id, 'rejected', ctx));
    btn('Approve and open', true, () => showDecision(id, 'approved', ctx));
  }
  if (q.status === 'open') {
    const pick = h('input', { type: 'file', multiple: 'true', accept: '.pdf,.docx', class: 'sr-only' }) as HTMLInputElement;
    const upload = h('label', { class: 'btn btn-primary file-pick' }, pick, icon('plus'), 'Upload CVs');
    pick.addEventListener('change', () => { const files = Array.from(pick.files ?? []); pick.value = ''; if (files.length) void bulkUpload(id, files, content, ctx); });
    acts.append(upload);
    btn('Copy apply link', false, async () => {
      const url = `${location.origin}/apply/${id}`;
      try { await navigator.clipboard.writeText(url); toast('Apply link copied'); } catch { toast(url); }
    });
    btn('Close', false, async () => {
      if (!confirm('Close this requisition? It stops accepting applications.')) return;
      await api.post(`/api/requisitions/${id}/close`); toast('Closed'); ctx.onChange();
    });
  }

  const facts = h('dl', { class: 'facts' },
    h('div', {}, h('dt', {}, 'Applications'), h('dd', {}, String(rows.length))),
    h('div', {}, h('dt', {}, 'Shortlisted'), h('dd', {}, String(shortlisted))),
    h('div', {}, h('dt', {}, 'Knocked out'), h('dd', {}, String(knocked))),
    h('div', {}, h('dt', {}, 'Headcount'), h('dd', {}, String(q.headcount))));
  const tags = h('div', { class: 'tags' }, h('span', { class: 'tag ink' }, word(q.status)));
  if (q.client) tags.append(h('span', { class: 'tag' }, `For ${q.client}`));
  if (q.salaryMin != null || q.salaryMax != null) tags.append(h('span', { class: 'tag' }, `${q.currency} ${q.salaryMin != null ? money(q.salaryMin) : '?'} to ${q.salaryMax != null ? money(q.salaryMax) : '?'} (internal)`));
  content.append(h('section', { class: 'panel cert guilloche' },
    h('div', { class: 'cert-in cert-in-2' },
      h('div', { class: 'who' }, h('h1', { class: 't-display' }, q.title),
        h('p', {}, [q.department, q.location, q.criteria.remoteOk ? 'Remote accepted' : ''].filter(Boolean).join(' · ') || 'No department or location set'),
        tags),
      facts),
    h('div', { class: 'cert-foot' },
      h('div', { class: 'cert-stamps' }, ...q.approvals.slice(-2).map(a => h('span', {}, mark(a.action === 'approved' ? 'confirmed' : 'claimed'), `${word(a.action)} by ${a.byName}, ${day(a.at)}`))),
      acts)));
  content.append(h('div', { id: 'upload-log' }));

  /* The ranked shortlist: every number is explained in one click. */
  const panel = h('section', { class: 'panel mt-6' },
    h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Ranked shortlist'),
      h('span', { class: 'eyebrow' }, q.shortlistAt != null ? `Shortlist at ${q.shortlistAt}` : 'No shortlist threshold')));
  if (!rows.length) {
    panel.append(empty(q.status === 'open' ? 'No applications yet. Upload CVs or share the apply link.' : 'Applications open once this requisition is approved.'));
  } else {
    const head = h('div', { class: 'rank-row rank-head', 'aria-hidden': 'true' },
      h('span', {}, 'Rank'), h('span', {}, 'Candidate'), h('span', {}, 'Score'),
      h('span', {}, 'Evidence per must-have'), h('span', {}, ''));
    panel.append(head);
    for (const row of rows) panel.append(rankRow(row, q, ctx));
    panel.append(h('div', { class: 'legend' },
      h('span', {}, mark('confirmed'), 'Verified'), h('span', {}, mark('claimed'), 'Claimed'),
      h('span', {}, mark('gap'), 'Partly'), h('span', {}, mark('blocking'), 'No evidence')));
  }
  content.append(panel);

  content.append(h('section', { class: 'panel mt-6' },
    h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Criteria'), h('span', { class: 'eyebrow' }, 'What scoring applies')),
    h('div', { class: 'fit' },
      ...q.criteria.mustHaves.map(mh => h('div', { class: 'fit-row' }, mark(mh.required ? 'blocking' : 'claimed'),
        h('div', {}, h('div', { class: 'req' }, mh.label), h('div', { class: 'src' }, mh.required ? 'Required: no evidence knocks out' : 'Optional: weighted')),
        h('span', { class: 'verdict' }, `Weight ${mh.weight}`)))),
    h('p', { class: 't-caption mt-3' }, [
      q.criteria.minYears != null ? `At least ${q.criteria.minYears} years` : 'No minimum years',
      q.criteria.locations.length ? `Locations: ${q.criteria.locations.join(', ')}${q.criteria.remoteOk ? ', or remote' : ''}` : 'Any location',
      q.criteria.workAuthRequired ? 'Work authorisation required' : 'Work authorisation not asked',
    ].join(' · '))));
}

function rankRow(row: Row, q: Requisition, ctx: HiringCtx): HTMLElement {
  const a = row.application;
  const c = row.candidate;
  const score = row.effectiveScore;
  const comps = a.score?.components ?? [];
  const knock = (a.score?.knockouts ?? []).filter(k => k.outcome === 'knocked_out');
  const rank = row.rank ? h('span', { class: 'rank-n' }, String(row.rank))
    : h('span', { class: 'rank-n is-out', title: row.excluded ? 'Excluded by a person' : 'Knocked out' }, row.excluded ? 'Ex' : 'Out');
  const meter = h('div', { class: 'meter-track' }, setWidthPct(h('div', { class: 'meter-fill' }), score ?? 0));
  if (q.shortlistAt != null) {
    const tick = h('span', { class: 'meter-tick', title: `Shortlist at ${q.shortlistAt}` });
    tick.style.left = `${Math.max(0, Math.min(100, q.shortlistAt))}%`;
    meter.append(tick);
  }
  const marks = h('div', { class: 'rank-marks' }, ...comps.map(cp => h('span', { class: 'rank-mark', title: `${cp.label}: ${EVIDENCE_WORD[cp.status] ?? cp.status}` }, mark(EVIDENCE_MARK[cp.status] ?? 'gap'))));
  const meta = [c.years != null ? `${c.years} yrs` : null, SOURCE_WORD[a.source] ?? a.source, a.dedup ? `matched existing: ${a.dedup.reason.replace(/\.$/, '')}` : null].filter(Boolean).join(' · ');
  const status = h('span', { class: `tag${a.status === 'shortlisted' ? ' ink' : ''}` }, word(a.status));
  const explain = h('button', { class: 'btn btn-sm' }, 'Explain');
  explain.addEventListener('click', () => showExplanation(row, q, ctx));
  const advance = h('button', { class: 'btn btn-sm' }, 'Advance');
  advance.addEventListener('click', async () => {
    try { const r = await api.post(`/api/applications/${a.id}/advance`) as { stage: string }; toast(`${c.name} moved to ${r.stage}`); ctx.onChange(); }
    catch (e) { toast(errorText(e)); }
  });
  return h('div', { class: `rank-row${row.knockedOut || row.excluded ? ' is-out' : ''}` },
    rank,
    h('div', { class: 'rank-who' }, avatar(c.name),
      h('div', {}, h('div', { class: 'rank-name' }, c.name, ' ', status),
        h('div', { class: 't-caption' }, `${a.stage} · ${meta}`),
        knock.length ? h('div', { class: 't-caption rank-knock' }, mark('blocking'), knock.map(k => k.reason).join(' ')) : '',
        a.override ? h('div', { class: 't-caption' }, mark('claimed'), `Override by ${a.override.by}: ${a.override.reason}`) : '')),
    h('div', { class: 'rank-score' }, h('b', { class: 'figures' }, score == null ? 'n/a' : String(score)), meter),
    marks,
    h('div', { class: 'rank-acts' }, explain, advance));
}

/* Why this score and rank: each must-have's points and sources, each
   knockout's reason, and any human override, then the override form. */
function showExplanation(row: Row, q: Requisition, ctx: HiringCtx): void {
  const a = row.application;
  const m = modal(`${row.candidate.name}: why this score`,
    'Every point below comes from evidence the platform holds. No model wrote these numbers.');
  const comps = a.score?.components ?? [];
  m.box.append(h('div', { class: 'fit' }, ...comps.map(cp => h('div', { class: 'fit-row' }, mark(EVIDENCE_MARK[cp.status] ?? 'gap'),
    h('div', {}, h('div', { class: 'req' }, cp.label + (cp.required ? ' (required)' : '')),
      h('div', { class: 'src' }, cp.sources.length ? `Evidence: ${cp.sources.join(', ')}` : 'No evidence found')),
    h('span', { class: 'verdict figures' }, `${cp.points} of ${cp.maxPoints}`)))));
  const total = a.score?.total ?? 0;
  const lines = [`Computed score ${total}`];
  if (a.override?.kind === 'adjust') lines.push(`${a.override.delta > 0 ? '+' : ''}${a.override.delta} adjustment by ${a.override.by}: ${a.override.reason}`);
  lines.push(`Score used for ranking ${row.effectiveScore ?? 'n/a'}${row.rank ? `, rank ${row.rank}` : ''}`);
  m.box.append(h('p', { class: 't-body mt-4' }, lines.join('. ') + '.'));
  const ks = a.score?.knockouts ?? [];
  if (ks.length) {
    m.box.append(h('h3', { class: 't-section mt-4' }, 'Knockouts'),
      ...ks.map(k => h('div', { class: 'srow' }, h('span', { class: 't-secondary' }, k.reason),
        stamp(k.outcome === 'knocked_out' ? 'Knocked out' : k.outcome === 'check' ? 'Check' : 'Pass', k.outcome === 'knocked_out' ? 'blocking' : k.outcome === 'check' ? 'gap' : 'confirmed'))));
  }

  /* Override: a reason is required and recorded with your name. */
  m.box.append(h('h3', { class: 't-section mt-6' }, 'Override'),
    h('p', { class: 't-caption' }, 'Re-scoring never removes an override. Your name, role and reason are kept in the audit trail.'));
  const kind = h('select', {}, h('option', { value: 'adjust' }, 'Adjust the score'),
    h('option', { value: 'include' }, 'Include despite a knockout'), h('option', { value: 'exclude' }, 'Exclude from the ranking')) as HTMLSelectElement;
  const delta = input('number', '0');
  const reason = h('textarea', { rows: '2', placeholder: 'Why. For example: reference confirmed Kafka in production.' }) as HTMLTextAreaElement;
  const deltaField = field('By how many points', delta, 'Positive or negative, shown as its own line.');
  kind.addEventListener('change', () => { deltaField.hidden = kind.value !== 'adjust'; });
  m.box.append(h('div', { class: 'form-grid' }, field('Action', kind), deltaField), field('Reason (required)', reason));
  const save = h('button', { class: 'btn btn-primary' }, 'Record override');
  save.addEventListener('click', async () => {
    if (!reason.value.trim()) { toast('A reason is required.'); return; }
    try {
      await api.post(`/api/applications/${a.id}/override`, { kind: kind.value, delta: Number(delta.value) || 0, reason: reason.value });
      m.close(); toast('Override recorded'); ctx.onChange();
    } catch (e) { toast(errorText(e)); }
  });
  const offer = h('button', { class: 'btn' }, 'Prepare offer');
  offer.addEventListener('click', () => { m.close(); showOffer(row, q, ctx); });
  const open = h('button', { class: 'btn btn-ghost' }, 'Open candidate');
  open.addEventListener('click', () => { m.close(); ctx.onCandidate?.(row.candidate.id); });
  m.box.append(h('div', { class: 'modal-acts' }, open, offer, save));
}

function showDecision(id: string, decision: 'approved' | 'rejected' | 'changes_requested', ctx: HiringCtx, kind: 'requisition' | 'offer' = 'requisition'): void {
  const titles = kind === 'offer'
    ? { approved: 'Approve offer', rejected: 'Reject offer', changes_requested: 'Request changes' }
    : { approved: 'Approve and open', rejected: 'Reject requisition', changes_requested: 'Request changes' };
  const ledes = kind === 'offer' ? {
    approved: 'The recruiter can then send it. Your approval is recorded with the version you saw.',
    rejected: 'The offer will not be sent. The reason is shown to the submitter.',
    changes_requested: 'It returns to draft; the edit becomes a new version that needs approval again.',
  } : {
    approved: 'Opening it lets candidates apply and starts scoring. Your approval is recorded.',
    rejected: 'The requisition will not open. The reason is shown to the submitter.',
    changes_requested: 'It returns to draft for the submitter to edit and resubmit.',
  };
  const m = modal(titles[decision], ledes[decision]);
  const comment = h('textarea', { rows: '3', placeholder: decision === 'approved' ? 'Optional note' : 'What needs to change, or why' }) as HTMLTextAreaElement;
  m.box.append(field('Comment', comment));
  const go = h('button', { class: 'btn btn-primary' }, titles[decision]);
  go.addEventListener('click', async () => {
    if (decision !== 'approved' && !comment.value.trim()) { toast('Add a comment so the submitter knows why.'); return; }
    try { await api.post(`/api/${kind === 'offer' ? 'offers' : 'requisitions'}/${id}/decision`, { decision, comment: comment.value }); m.close(); toast('Recorded'); ctx.onChange(); }
    catch (e) { toast(errorText(e)); }
  });
  const cancel = h('button', { class: 'btn' }, 'Cancel');
  cancel.addEventListener('click', m.close);
  m.box.append(h('div', { class: 'modal-acts' }, cancel, go));
}

/* Bulk CV upload: one request per file, each with its own result line, so a
   bad file is reported and the rest carry on. */
async function bulkUpload(reqId: string, files: File[], content: HTMLElement, ctx: HiringCtx): Promise<void> {
  const log = content.querySelector('#upload-log') as HTMLElement;
  const panel = h('section', { class: 'panel mt-6' },
    h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Uploading CVs'), h('span', { class: 'eyebrow' }, `${files.length} files`)));
  log.replaceChildren(panel);
  for (const f of files) {
    const line = h('div', { class: 'srow' }, h('span', { class: 't-body' }, f.name), h('span', { class: 't-caption' }, 'Reading...'));
    panel.append(line);
    try {
      if (f.size > 5 * 1024 * 1024) throw new Error('document_too_large');
      const r = await api.post(`/api/requisitions/${reqId}/upload`, { filename: f.name, dataBase64: await fileToBase64(f) }) as
        { name: string; created: boolean; dedup: string | null; rolesRead: number; status: string; score: number | null };
      line.replaceChildren(h('span', { class: 't-body' }, `${r.name}`, h('span', { class: 't-caption' }, ` from ${f.name}`)),
        h('span', { class: 't-caption' }, [r.created ? 'New candidate' : `Matched existing (${(r.dedup ?? '').replace(/\.$/, '')})`,
          `${r.rolesRead} roles read`, r.score != null ? `score ${r.score}` : 'not scored', word(r.status)].join(' · ')));
    } catch (e) {
      line.replaceChildren(h('span', { class: 't-body' }, f.name), h('span', { class: 't-caption rank-knock' }, mark('blocking'), errorText(e)));
    }
  }
  toast('Upload finished');
  setTimeout(() => ctx.onChange(), 900);
}

/* Offer: terms in a form; the letter is generated server-side; approval by
   someone other than the submitter before it can be sent. */
function showOffer(row: Row, q: Requisition, ctx: HiringCtx): void {
  const m = modal(`Offer for ${row.candidate.name}`,
    ctx.hiringModel === 'agency'
      ? 'Draft the client\'s offer. An approver records the client\'s confirmation before it is sent.'
      : 'Draft the offer. Someone other than you approves it before it can be sent.');
  const mid = q.salaryMin != null && q.salaryMax != null ? Math.round((q.salaryMin + q.salaryMax) / 2) : '';
  const salary = input('number', String(mid), 'Annual salary');
  const currency = input('text', q.currency || 'AED');
  const start = input('date', '');
  const notes = h('textarea', { rows: '3', placeholder: 'Benefits, conditions, anything the letter should state' }) as HTMLTextAreaElement;
  m.box.append(h('div', { class: 'form-grid' },
    field('Annual salary', salary, q.salaryMin != null ? `Band ${q.currency} ${money(q.salaryMin)} to ${q.salaryMax != null ? money(q.salaryMax) : '?'}` : 'No band set'),
    field('Currency', currency), field('Start date', start)), field('Notes', notes));
  const go = h('button', { class: 'btn btn-primary' }, 'Draft and submit for approval');
  go.addEventListener('click', async () => {
    if (!salary.value || !start.value) { toast('Salary and start date are needed.'); return; }
    try {
      const { offer } = await api.post(`/api/applications/${row.application.id}/offers`, {
        terms: { salary: Number(salary.value), currency: currency.value, startDate: start.value, location: q.location, notes: notes.value },
      }) as { offer: { id: string } };
      await api.post(`/api/offers/${offer.id}/submit`);
      m.close(); toast('Offer submitted for approval'); ctx.onChange();
    } catch (e) { toast(errorText(e)); }
  });
  const cancel = h('button', { class: 'btn' }, 'Cancel');
  cancel.addEventListener('click', m.close);
  m.box.append(h('div', { class: 'modal-acts' }, cancel, go));
}

/* ---------------------------------------------------------------------- */
/* Approvals (HR and admin)                                                */

export async function renderApprovals(content: HTMLElement, ctx: HiringCtx): Promise<void> {
  const data = await api.get('/api/hr/approvals') as {
    requisitions: Array<{ id: string; title: string; submittedBy: string; submittedAt: string }>;
    offers: Array<{
      id: string; requisitionId: string; requisitionTitle: string; candidateName: string; submittedAt: string; submittedBy: string;
      salary: number | null; currency: string; startDate: string; bandMin: number | null; bandMax: number | null;
    }>;
  };
  content.append(viewHeader('Approvals', 'Requisitions and offers waiting on an approver. You cannot approve what you submitted.'));
  const reqs = h('section', { class: 'panel mt-6' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Requisitions'),
    h('span', { class: 'eyebrow' }, `${data.requisitions.length} waiting`)));
  if (!data.requisitions.length) reqs.append(empty('Nothing waiting.'));
  for (const r of data.requisitions) {
    const open = h('button', { class: 'btn btn-sm btn-primary' }, 'Review');
    open.addEventListener('click', () => ctx.onOpen(r.id));
    reqs.append(h('div', { class: 'srow' }, h('div', {}, h('div', { class: 't-body' }, r.title),
      h('div', { class: 't-caption' }, `Submitted by ${r.submittedBy || 'unknown'}, ${day(r.submittedAt)}`)), open));
  }
  const offers = h('section', { class: 'panel mt-6' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Offers'),
    h('span', { class: 'eyebrow' }, `${data.offers.length} waiting`)));
  if (!data.offers.length) offers.append(empty('Nothing waiting.'));
  for (const o of data.offers) {
    const approve = h('button', { class: 'btn btn-sm btn-primary' }, 'Approve');
    const reject = h('button', { class: 'btn btn-sm' }, 'Reject');
    approve.addEventListener('click', () => showDecision(o.id, 'approved', ctx, 'offer'));
    reject.addEventListener('click', () => showDecision(o.id, 'rejected', ctx, 'offer'));
    /* The approver decides on the terms, so they sit on the row with the band. */
    const inBand = o.salary == null || o.bandMin == null || o.bandMax == null ? null : o.salary >= o.bandMin && o.salary <= o.bandMax;
    const terms = [
      o.salary != null ? `${o.currency} ${money(o.salary)}` : 'No salary set',
      o.bandMin != null && o.bandMax != null ? `band ${money(o.bandMin)} to ${money(o.bandMax)}${inBand === false ? ', outside the band' : ''}` : 'no band',
      o.startDate ? `starts ${o.startDate}` : '',
    ].filter(Boolean).join(' · ');
    offers.append(h('div', { class: 'srow' }, h('div', {}, h('div', { class: 't-body' }, `${o.candidateName}, ${o.requisitionTitle}`),
      h('div', { class: inBand === false ? 't-caption t-warn' : 't-caption' }, terms),
      h('div', { class: 't-caption' }, `Submitted by ${o.submittedBy || 'unknown'}, ${day(o.submittedAt)}`)), h('div', { class: 'row gap-2' }, reject, approve)));
  }
  content.append(reqs, offers);
}

/* ---------------------------------------------------------------------- */
/* Reports (HR and admin)                                                  */

interface Report {
  generatedAt: string;
  totals: { requisitions: number; open: number; applications: number; knockedOut: number; overridden: number; hired: number };
  requisitions: Array<{ requisitionId: string; title: string; status: string; applications: number; knockedOut: number; overridden: number; averageScore: number | null; byStatus: Record<string, number>; byStage: Record<string, number> }>;
  bySource: Record<string, number>;
  knockoutReasons: Array<{ rule: string; label: string; count: number }>;
  offers: { sent: number; accepted: number; declined: number; acceptanceRate: number | null };
  daysInStage: Array<{ stage: string; averageDays: number | null; moves: number }>;
}

function bars(items: Array<{ label: string; value: number; note?: string }>): HTMLElement {
  const max = Math.max(1, ...items.map(i => i.value));
  return h('div', { class: 'bars' }, ...items.map(i => h('div', { class: 'bar-row' },
    h('span', { class: 't-secondary' }, i.label),
    h('div', { class: 'meter-track' }, setWidthPct(h('div', { class: 'meter-fill' }), (i.value / max) * 100)),
    h('span', { class: 'figures' }, i.note ?? String(i.value)))));
}

function csv(report: Report): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Requisition', 'Status', 'Applications', 'Knocked out', 'Overridden', 'Average score'];
  const lines = report.requisitions.map(r => [r.title, r.status, r.applications, r.knockedOut, r.overridden, r.averageScore ?? ''].map(esc).join(','));
  return [head.map(esc).join(','), ...lines].join('\r\n');
}

export async function renderReports(content: HTMLElement): Promise<void> {
  const report = await api.get('/api/hr/reports') as Report;
  const exportBtn = h('button', { class: 'btn' }, 'Export CSV');
  exportBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv(report)], { type: 'text/csv' }));
    a.download = `hiring-report-${report.generatedAt.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  content.append(viewHeader('Reports', 'Counts, averages and durations computed from the record. No model writes a figure here.', [exportBtn]));
  content.append(h('section', { class: 'panel mt-6' }, h('dl', { class: 'facts facts-left facts-6 facts-flat' },
    h('div', {}, h('dt', {}, 'Requisitions'), h('dd', {}, String(report.totals.requisitions))),
    h('div', {}, h('dt', {}, 'Open'), h('dd', {}, String(report.totals.open))),
    h('div', {}, h('dt', {}, 'Applications'), h('dd', {}, String(report.totals.applications))),
    h('div', {}, h('dt', {}, 'Knocked out'), h('dd', {}, String(report.totals.knockedOut))),
    h('div', {}, h('dt', {}, 'Offer acceptance'), h('dd', {}, report.offers.acceptanceRate == null ? 'n/a' : `${report.offers.acceptanceRate}%`)),
    h('div', {}, h('dt', {}, 'Hired'), h('dd', {}, String(report.totals.hired))))));

  const funnelStatuses = ['new', 'screened', 'shortlisted', 'knocked_out', 'hired'];
  const totalsByStatus = funnelStatuses.map(s => ({ label: word(s), value: report.requisitions.reduce((n, r) => n + (r.byStatus[s] ?? 0), 0) }));
  const grid = h('div', { class: 'grid-even mt-6' });
  grid.append(
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Screening funnel'), h('span', { class: 'eyebrow' }, 'All requisitions')), bars(totalsByStatus)),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Time in stage'), h('span', { class: 'eyebrow' }, 'Average days, completed moves')),
      bars(report.daysInStage.map(d => ({ label: d.stage, value: d.averageDays ?? 0, note: d.averageDays == null ? 'no moves' : `${d.averageDays} d · ${d.moves}` })))),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Where applications came from')),
      bars(Object.entries(report.bySource).map(([k, v]) => ({ label: SOURCE_WORD[k] ?? k, value: v })))),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Knockout reasons')),
      report.knockoutReasons.length ? bars(report.knockoutReasons.map(k => ({ label: k.label, value: k.count }))) : empty('No knockouts.')));
  content.append(grid);

  const table = h('section', { class: 'panel mt-6' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'By requisition')));
  if (!report.requisitions.length) table.append(empty('No requisitions to report on.'));
  for (const r of report.requisitions) {
    table.append(h('div', { class: 'srow' },
      h('div', {}, h('div', { class: 't-body' }, r.title), h('div', { class: 't-caption' }, `${r.applications} applications · ${r.knockedOut} knocked out · ${r.overridden} overridden`)),
      h('div', { class: 'row gap-2' }, stamp(word(r.status), STATUS_MARK[r.status] ?? 'claimed'),
        h('span', { class: 't-body figures' }, r.averageScore === null ? 'no score' : `avg ${r.averageScore}`))));
  }
  content.append(table);
}
