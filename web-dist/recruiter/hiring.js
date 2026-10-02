/* Requisitions, offers and reports for the recruiter and HR surfaces
   (ADR-0024). State comes from the API; nothing is computed here beyond
   formatting. Kept separate from the pipeline view so both stay readable. */
import { api } from '../shared/api.js';
import { h, mark, stamp, toast, empty, viewHeader, icon } from '../shared/dom.js';
const STATUS_MARK = {
    open: 'confirmed', pending_approval: 'conflict', approved: 'confirmed', sent: 'claimed',
    accepted: 'confirmed', declined: 'gap', rejected: 'blocking', draft: 'claimed', closed: 'gap', hired: 'confirmed',
};
function money(q) {
    if (q.salaryMin == null && q.salaryMax == null)
        return 'Salary not set';
    return `${q.currency} ${q.salaryMin ?? '?'} to ${q.salaryMax ?? '?'} (internal)`;
}
function promptNumber(message) {
    const raw = prompt(message);
    if (raw === null)
        return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}
/* ---------- requisitions list ---------- */
export async function renderRequisitions(content, ctx) {
    const data = await api.get('/api/requisitions');
    const create = h('button', { class: 'btn btn-primary' }, icon('plus'), 'New requisition');
    create.addEventListener('click', () => showCreate(ctx));
    content.append(viewHeader('Requisitions', 'A role many candidates apply to. One approval before it opens; the approver is never the submitter.', [create]));
    if (!data.requisitions.length) {
        content.append(empty('No requisitions yet. Create one to start a pipeline.', { label: 'New requisition', fn: () => showCreate(ctx) }));
        return;
    }
    const table = h('div', { class: 'mt-6' });
    for (const q of data.requisitions) {
        const row = h('div', { class: 'srow' }, h('div', {}, h('div', { class: 't-body row gap-2' }, mark(STATUS_MARK[q.status] ?? 'claimed'), q.title, q.client ? h('span', { class: 'tag' }, q.client) : ''), h('div', { class: 't-caption' }, `${q.department || 'No department'} · ${q.location || 'No location'} · ${q.headcount} head${q.headcount === 1 ? '' : 's'} · ${q.criteria.mustHaves.length} must-haves`)), h('div', { class: 'row gap-2' }, stamp(q.status.replace('_', ' '), STATUS_MARK[q.status] ?? 'claimed'), h('button', { class: 'btn btn-sm' }, 'Open')));
        row.addEventListener('click', () => ctx.onOpen(q.id));
        table.append(row);
    }
    content.append(table);
}
function showCreate(ctx) {
    const scrim = h('div', { class: 'scrim' });
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h2', { class: 't-view' }, 'New requisition'), h('p', { class: 't-secondary' }, 'Must-haves are scored deterministically. A required must-have with no evidence knocks the application out.'));
    const title = h('input', { type: 'text', placeholder: 'Senior Platform Engineer' });
    const department = h('input', { type: 'text', placeholder: 'Platform' });
    const location = h('input', { type: 'text', placeholder: 'Dubai' });
    const client = h('input', { type: 'text', placeholder: 'Client (agency only)' });
    const salaryMin = h('input', { type: 'number', placeholder: 'Salary min' });
    const salaryMax = h('input', { type: 'number', placeholder: 'Salary max' });
    const minYears = h('input', { type: 'number', placeholder: 'Minimum years' });
    const mustHaves = h('textarea', { rows: '4', placeholder: 'One must-have per line. Prefix with "* " for a required one.' });
    modal.append(h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Title'), title), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Department'), department), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Location'), location), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Client'), client), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Salary band (internal)'), h('div', { class: 'row gap-2' }, salaryMin, salaryMax)), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Minimum years'), minYears), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Must-haves'), mustHaves));
    const save = h('button', { class: 'btn btn-primary' }, 'Create draft');
    save.addEventListener('click', async () => {
        const criteria = {
            mustHaves: mustHaves.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => ({ label: l.replace(/^\*\s*/, ''), required: l.startsWith('*'), weight: 1 })),
            minYears: minYears.value ? Number(minYears.value) : null,
        };
        try {
            await api.post('/api/requisitions', {
                title: title.value, department: department.value, location: location.value, client: client.value || null,
                salaryMin: salaryMin.value ? Number(salaryMin.value) : null, salaryMax: salaryMax.value ? Number(salaryMax.value) : null,
                criteria,
            });
            scrim.remove();
            toast('Requisition drafted');
            ctx.onChange();
        }
        catch (e) {
            toast(String(e.message));
        }
    });
    const cancel = h('button', { class: 'btn ml-2' }, 'Cancel');
    cancel.addEventListener('click', () => scrim.remove());
    modal.append(h('div', {}, save, cancel));
    scrim.append(modal);
    document.body.append(scrim);
    title.focus();
}
/* ---------- requisition detail ---------- */
export async function renderRequisitionDetail(content, id, ctx) {
    const data = await api.get(`/api/requisitions/${id}`);
    const q = data.requisition;
    const back = h('button', { class: 'btn btn-sm' }, 'Back to requisitions');
    back.addEventListener('click', () => ctx.onChange());
    const acts = [back];
    if (q.status === 'draft' || q.status === 'rejected') {
        const submit = h('button', { class: 'btn btn-primary' }, 'Submit for approval');
        submit.addEventListener('click', async () => { await api.post(`/api/requisitions/${id}/submit`); toast('Submitted'); ctx.onChange(); });
        acts.push(submit);
    }
    if (q.status === 'pending_approval' && ctx.role !== 'recruiter') {
        const approve = h('button', { class: 'btn btn-primary' }, 'Approve');
        approve.addEventListener('click', async () => {
            try {
                await api.post(`/api/requisitions/${id}/decision`, { decision: 'approved' });
                toast('Approved');
                ctx.onChange();
            }
            catch (e) {
                toast(String(e.message));
            }
        });
        const changes = h('button', { class: 'btn' }, 'Request changes');
        changes.addEventListener('click', async () => { await api.post(`/api/requisitions/${id}/decision`, { decision: 'changes_requested', comment: prompt('What needs to change?') ?? '' }); toast('Changes requested'); ctx.onChange(); });
        acts.push(approve, changes);
    }
    if (q.status === 'open') {
        const rescore = h('button', { class: 'btn' }, 'Re-score all');
        rescore.addEventListener('click', async () => { const r = await api.post(`/api/requisitions/${id}/rescore`); toast(`Scored ${r.scored}, ${r.changed} changed`); ctx.onChange(); });
        acts.push(rescore);
    }
    content.append(viewHeader(q.title, `${q.department || 'No department'} · ${q.location || 'No location'} · ${money(q)}`, acts));
    content.append(h('section', { class: 'panel mt-6' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Criteria'), h('span', { class: 'eyebrow' }, 'Deterministic scoring')), h('div', { class: 'fit' }, ...q.criteria.mustHaves.map(m => h('div', { class: 'fit-row' }, mark(m.required ? 'blocking' : 'claimed'), h('div', {}, h('div', { class: 'req' }, m.label), h('div', { class: 'src' }, m.required ? 'Required, a gap knocks out' : 'Optional, weighted')), h('span', { class: `verdict is-${m.required ? 'gap' : 'claimed'}` }, `weight ${m.weight}`))))));
    const panel = h('section', { class: 'panel mt-6' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Ranked pipeline'), h('span', { class: 'eyebrow' }, `${data.rows.length} applications`)));
    if (!data.rows.length)
        panel.append(empty('No applications yet.'));
    for (const row of data.rows) {
        const c = row.candidate;
        const scoreLine = row.effectiveScore === null ? 'Not scored'
            : `${row.effectiveScore} of 100${row.application.answers.__override ? ' (adjusted)' : ''}`;
        const overrideBtn = h('button', { class: 'btn btn-sm' }, 'Override');
        const offerBtn = h('button', { class: 'btn btn-sm btn-primary' }, 'Offer');
        const line = h('div', { class: 'srow' }, h('div', {}, h('div', { class: 't-body row gap-2' }, row.rank ? h('strong', {}, `#${row.rank}`) : mark(row.knockedOut ? 'blocking' : 'claimed'), c.name, h('span', { class: 'tag' }, row.application.status.replace('_', ' '))), h('div', { class: 't-caption' }, `${c.email ?? 'no email'} · ${c.years ?? '?'} years · score ${scoreLine} · source ${row.application.source}`)), h('div', { class: 'row gap-2' }, overrideBtn, offerBtn));
        overrideBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const kind = prompt('Override kind: adjust, include or exclude');
            if (!kind || !['adjust', 'include', 'exclude'].includes(kind))
                return;
            const delta = kind === 'adjust' ? promptNumber('Adjust by (for example 10 or -5):') : 0;
            const reason = prompt('Reason (required, audited):');
            if (!reason) {
                toast('A reason is required');
                return;
            }
            try {
                await api.post(`/api/applications/${row.application.id}/override`, { kind, delta, reason });
                toast('Override recorded');
                ctx.onChange();
            }
            catch (err) {
                toast(String(err.message));
            }
        });
        offerBtn.addEventListener('click', async (e) => { e.stopPropagation(); await showOffer(row, ctx); });
        panel.append(line);
    }
    content.append(panel);
    content.append(h('section', { class: 'panel mt-6' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Approvals and audit')), ...q.approvals.map(a => h('div', { class: 'stagerow' }, h('span', { class: 't-secondary' }, `${a.action.replace('_', ' ')} by ${a.byName} (${a.role})`), h('span', { class: 't-caption' }, a.comment || a.at.slice(0, 10))))));
}
async function showOffer(row, ctx) {
    const salary = promptNumber('Annual salary for the offer:');
    if (salary === null)
        return;
    const startDate = prompt('Start date (YYYY-MM-DD):') ?? '';
    const currency = prompt('Currency (for example AED):') ?? 'AED';
    let offer;
    try {
        offer = (await api.post(`/api/applications/${row.application.id}/offers`, { terms: { salary, startDate, currency } })).offer;
    }
    catch (e) {
        toast(String(e.message));
        return;
    }
    toast('Offer drafted');
    await api.post(`/api/offers/${offer.id}/submit`);
    toast('Offer submitted for approval. An HR approver sends it.');
    ctx.onChange();
}
/* ---------- reports (HR and admin) ---------- */
export async function renderReports(content) {
    const report = await api.get('/api/hr/reports');
    content.append(viewHeader('Reports', 'Counts and averages only. No model writes a figure here.'));
    const facts = h('dl', { class: 'facts mt-6' }, h('div', {}, h('dt', {}, 'Requisitions'), h('dd', {}, String(report.totals.requisitions))), h('div', {}, h('dt', {}, 'Open'), h('dd', {}, String(report.totals.open))), h('div', {}, h('dt', {}, 'Applications'), h('dd', {}, String(report.totals.applications))), h('div', {}, h('dt', {}, 'Knocked out'), h('dd', {}, String(report.totals.knockedOut))), h('div', {}, h('dt', {}, 'Overridden'), h('dd', {}, String(report.totals.overridden))), h('div', {}, h('dt', {}, 'Hired'), h('dd', {}, String(report.totals.hired))));
    content.append(facts);
    const table = h('section', { class: 'panel mt-6' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'By requisition')));
    if (!report.requisitions.length)
        table.append(empty('No requisitions to report on.'));
    for (const r of report.requisitions) {
        table.append(h('div', { class: 'srow' }, h('div', {}, h('div', { class: 't-body' }, r.title), h('div', { class: 't-caption' }, `${r.applications} applications · ${r.knockedOut} knocked out · ${r.overridden} overridden`)), h('div', { class: 'row gap-2' }, stamp(r.status.replace('_', ' '), STATUS_MARK[r.status] ?? 'claimed'), r.averageScore === null ? h('span', { class: 't-caption' }, 'No score') : h('span', { class: 't-body figures' }, `avg ${r.averageScore}`))));
    }
    content.append(table);
}
