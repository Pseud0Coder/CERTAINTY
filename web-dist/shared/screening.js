/* Screening view (ADR-0027), shared by the recruiter and candidate apps.
   One CV against one JD: a scorecard with a quote behind every grade, the
   facts counted in code, and next steps for each side. Recruiter first: the
   recruiter's list leads for staff, the candidate's for a candidate. */
import { api } from './api.js';
import { h, stamp, toast, empty, clear, viewHeader, fileToBase64, setWidthPct } from './dom.js';
const ERRORS = {
    cv_required: 'Add the CV: upload a file or paste its text.',
    jd_required: 'Add the job description: upload a file or paste its text.',
    cv_too_short: 'The CV text is too short to screen.',
    jd_too_short: 'The job description is too short to screen.',
    cv_scanned_document: 'That CV looks like a scan with no text layer. Upload a text PDF or a Word file.',
    jd_scanned_document: 'That job description looks like a scan with no text layer. Paste its text instead.',
    cv_unsupported_format: 'Upload the CV as a PDF or Word (.docx) file.',
    jd_unsupported_format: 'Upload the job description as a PDF or Word (.docx) file.',
    cv_document_too_large: 'That CV file is too large.', jd_document_too_large: 'That job description file is too large.',
    daily_limit_reached: 'Daily screening limit reached. Try again tomorrow.',
    instance_limit_reached: 'This demo has reached its daily screening capacity. Try again tomorrow.',
    busy: 'The server is busy with other screenings. Try again in a minute.',
    screening_failed: 'The screening did not complete. Try again.',
    job_not_found: 'The server restarted while this was running. Run it again.',
};
const REC_MARK = {
    'Strong Match': 'confirmed', 'Moderate Match': 'claimed', 'Weak Match': 'gap', 'No Match': 'gap',
};
export async function renderScreening(content, audience) {
    content.append(viewHeader('Screening', audience === 'recruiter'
        ? 'Score a CV against a strict job description. Every grade rests on a quote from the CV, and a missing must-have caps the result.'
        : 'Check your CV against a job description before you apply. You see the same scorecard a recruiter would, with steps to improve it.'));
    const cv = { file: null, text: '' };
    const jd = { file: null, text: '' };
    let busy = false;
    const out = h('div', { id: 'screening-out', class: 'mt-6' });
    const historyBox = h('section', { class: 'panel mt-6', 'aria-label': 'Recent screenings' });
    const part = (label, hint, p, id) => {
        const fileName = h('span', { class: 't-caption' }, 'No file chosen');
        const input = h('input', { type: 'file', accept: '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document', class: 'sr-only', id: `${id}-file` });
        input.addEventListener('change', () => {
            p.file = input.files?.[0] ?? null;
            fileName.textContent = p.file ? p.file.name : 'No file chosen';
        });
        const area = h('textarea', { rows: '9', id: `${id}-text`, placeholder: hint, 'aria-label': `${label} text` });
        area.addEventListener('input', () => { p.text = area.value; });
        return h('div', { class: 'sc-part' }, h('h2', { class: 't-section' }, label), h('div', { class: 'row gap-2 wrap mt-2' }, h('label', { class: 'btn file-pick' }, input, 'Upload PDF or Word'), fileName), h('p', { class: 't-caption mt-2' }, 'Or paste the text. An uploaded file wins over pasted text.'), area);
    };
    const github = h('input', { type: 'text', id: 'sc-github', placeholder: 'Optional: GitHub username or profile URL', 'aria-label': 'GitHub username' });
    const label = h('input', { type: 'text', id: 'sc-label', placeholder: 'Optional: a name for this screening', 'aria-label': 'Screening name' });
    const run = h('button', { class: 'btn btn-primary', id: 'sc-run' }, 'Run screening');
    const status = h('span', { class: 't-caption', role: 'status' });
    run.addEventListener('click', async () => {
        if (busy)
            return;
        const toPart = async (p) => p.file
            ? { filename: p.file.name, dataBase64: await fileToBase64(p.file) }
            : { text: p.text };
        if (!cv.file && !cv.text.trim()) {
            toast(ERRORS['cv_required']);
            return;
        }
        if (!jd.file && !jd.text.trim()) {
            toast(ERRORS['jd_required']);
            return;
        }
        if ((cv.file && cv.file.size > 5 * 1024 * 1024) || (jd.file && jd.file.size > 5 * 1024 * 1024)) {
            toast('A file is larger than 5 MB.');
            return;
        }
        busy = true;
        run.setAttribute('disabled', 'true');
        status.textContent = '';
        try {
            const started = await api.post('/api/screenings', {
                cv: await toPart(cv), jd: await toPart(jd), githubUsername: github.value, label: label.value,
            });
            const id = await followJob(started.jobId, started.steps);
            const res = await api.get(`/api/screenings/${id}`);
            showResult(res.screening);
            await loadHistory();
            if (res.screening.meta.githubError)
                toast('The GitHub account could not be read, so it was left out.');
            out.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        catch (e) {
            clear(out);
            toast(ERRORS[String(e.message)] ?? 'The screening did not complete. Try again.');
        }
        finally {
            busy = false;
            run.removeAttribute('disabled');
        }
    });
    /* Shows the stages of a running job and resolves with the result id. */
    async function followJob(jobId, steps) {
        clear(out);
        const list = h('ol', { class: 'sc-progress-list' }, ...steps.map(label => h('li', { 'data-state': 'todo' }, label)));
        const note = h('p', { class: 't-caption mt-2', role: 'status' }, 'Starting');
        out.append(h('section', { class: 'panel sc-progress', 'aria-label': 'Screening progress' }, h('h2', { class: 't-section' }, 'Screening in progress'), list, note));
        for (let i = 0; i < 240; i++) {
            const { job } = await api.get(`/api/screenings/jobs/${jobId}`);
            Array.from(list.children).forEach((li, n) => li.setAttribute('data-state', job.status === 'done' || n < job.step ? 'done' : n === job.step ? 'now' : 'todo'));
            note.textContent = job.status === 'running' ? `${job.stepLabel}. ${Math.round(job.elapsedMs / 1000)} seconds so far.` : job.status === 'done' ? 'Done.' : '';
            if (job.status === 'done' && job.resultId)
                return job.resultId;
            if (job.status === 'failed')
                throw new Error(job.error ?? 'screening_failed');
            await new Promise(r => setTimeout(r, 1000));
        }
        throw new Error('screening_failed');
    }
    content.append(h('section', { class: 'panel', 'aria-label': 'New screening' }, h('div', { class: 'sc-inputs' }, part('Candidate CV', 'Paste the CV text here', cv, 'sc-cv'), part('Job description', 'Paste the job description here', jd, 'sc-jd')), h('div', { class: 'sc-extras mt-4' }, github, label), h('div', { class: 'row gap-3 mt-4' }, run, status)), out, historyBox);
    function showResult(s) {
        clear(out);
        out.append(renderResult(s, audience, async () => {
            await api.del(`/api/screenings/${s.id}`);
            clear(out);
            toast('Screening deleted');
            await loadHistory();
        }));
    }
    async function loadHistory() {
        clear(historyBox);
        historyBox.append(h('h2', { class: 't-section' }, 'Recent screenings'));
        let items = [];
        try {
            items = (await api.get('/api/screenings')).items;
        }
        catch { /* leave empty */ }
        if (!items.length) {
            historyBox.append(empty('No screenings yet. Run one above.'));
            return;
        }
        const list = h('ul', { class: 'sc-history' });
        for (const it of items.slice(0, 12)) {
            const b = h('button', { class: 'sc-hist-item' }, h('span', { class: 'sc-hist-score' }, it.overall.toFixed(1)), h('span', { class: 'sc-hist-main' }, h('span', { class: 't-body' }, it.label || it.jobTitle || 'Screening'), h('span', { class: 't-caption' }, `${it.recommendation} · ${it.createdAt.slice(0, 10)}`)));
            b.addEventListener('click', async () => {
                try {
                    showResult((await api.get(`/api/screenings/${it.id}`)).screening);
                    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                catch {
                    toast('Could not open that screening.');
                }
            });
            list.append(h('li', {}, b));
        }
        historyBox.append(list);
    }
    await loadHistory();
}
function renderResult(s, audience, onDelete) {
    const r = s.result;
    const root = h('div', { class: 'sc-result' });
    /* Hero */
    const bar = h('div', { class: 'sc-bar' }, setWidthPct(h('div', { class: 'sc-bar-fill' }), (r.overall / 5) * 100));
    root.append(h('section', { class: 'panel sc-hero', 'aria-label': 'Result' }, h('div', { class: 'sc-score' }, h('span', { class: 'sc-score-n' }, r.overall.toFixed(1)), h('span', { class: 't-caption' }, 'out of 5')), h('div', { class: 'sc-hero-main' }, h('div', { class: 'row gap-2 wrap' }, stamp(r.recommendation, REC_MARK[r.recommendation] ?? 'claimed'), r.jobTitle ? h('span', { class: 't-secondary' }, r.jobTitle) : h('span', {})), bar, h('p', { class: 't-body mt-2' }, r.summary), ...(r.capReason ? [h('p', { class: 'sc-cap t-secondary mt-2' }, r.capReason)] : []), h('p', { class: 't-caption mt-2' }, r.producer === 'model'
        ? 'Rubric and quotes proposed by the model, then checked in code against the CV. Totals, caps and next steps are computed, not generated.'
        : 'Deterministic reading, no model used. The same inputs always give the same scorecard.'))));
    /* Tiles */
    const tiles = (cs) => h('div', { class: 'sc-grid' }, ...cs.map(tile));
    const core = r.criteria.filter(c => c.category === 'universal');
    const role = r.criteria.filter(c => c.category === 'role');
    root.append(h('h2', { class: 'sc-eyebrow mt-6' }, 'Core axes'), tiles(core));
    if (role.length)
        root.append(h('h2', { class: 'sc-eyebrow mt-6' }, 'Role axes, read from the job description'), tiles(role));
    /* Facts counted in code */
    const f = r.facts;
    const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value));
    root.append(h('div', { class: 'statstrip mt-6' }, stat('Years of experience', f.years === null ? 'Not found' : `${f.years}${f.minYears ? ` of ${f.minYears}+` : ''}`), stat('Roles read', String(f.roles)), stat('Bullets with a figure', `${f.quantifiedBullets} of ${f.bullets}`), stat('JD skills named in CV', f.skillsRequired.length ? `${f.skillsFound.length} of ${f.skillsRequired.length}` : 'None listed')));
    if (f.skillsMissing.length)
        root.append(h('p', { class: 't-caption mt-2' }, `Not named in the CV: ${f.skillsMissing.join(', ')}`));
    /* GitHub evidence */
    if (r.github)
        root.append(githubPanel(r.github));
    else if (s.meta.githubError)
        root.append(h('p', { class: 't-caption mt-4' }, 'The GitHub account could not be read, so it was left out.'));
    /* Next steps, the viewer's side first */
    const order = audience === 'recruiter' ? ['recruiter', 'candidate'] : ['candidate', 'recruiter'];
    const titles = { recruiter: 'For the recruiter', candidate: 'For the candidate' };
    const lists = new Map();
    const tabs = h('div', { class: 'tabs sc-tabs', role: 'tablist' });
    const body = h('div', { class: 'sc-steps' });
    const show = (who) => {
        for (const k of order)
            tabs.querySelector(`[data-who="${k}"]`)?.setAttribute('aria-selected', k === who ? 'true' : 'false');
        clear(body);
        body.append(lists.get(who));
    };
    for (const who of order) {
        const ul = h('ol', { class: 'sc-step-list' });
        const steps = r.nextSteps[who];
        for (const st of steps)
            ul.append(h('li', {}, st.criterion ? h('span', { class: 'sc-step-tag' }, st.criterion) : h('span', {}), st.text));
        if (!steps.length)
            ul.append(h('li', {}, 'Nothing to add.'));
        lists.set(who, ul);
        const b = h('button', { class: 'tab', role: 'tab', 'data-who': who }, titles[who]);
        b.addEventListener('click', () => show(who));
        tabs.append(b);
    }
    root.append(h('h2', { class: 'sc-eyebrow mt-6' }, 'Next steps'), tabs, body);
    show(order[0]);
    const del = h('button', { class: 'btn btn-sm btn-ghost mt-6' }, 'Delete this screening');
    del.addEventListener('click', () => { if (confirm('Delete this screening and the text it stored?'))
        void onDelete(); });
    root.append(h('div', { class: 'row gap-3 wrap mt-6' }, del, h('span', { class: 't-caption' }, `Run ${s.createdAt.slice(0, 16).replace('T', ' ')} UTC${s.meta.cvFile ? ` · ${s.meta.cvFile}` : ''}`)));
    return root;
}
function tile(c) {
    const evSource = (e) => e.source === 'cv' ? 'From the CV' : e.source === 'github' ? 'From GitHub, unverified' : 'Computed from the CV';
    const body = h('div', { class: 'sc-tile-body' }, h('p', { class: 't-caption' }, `Requirement: ${c.requirement}`), h('p', { class: 't-secondary mt-2' }, c.rationale));
    if (c.evidence) {
        body.append(h('blockquote', { class: 'sc-quote mt-2' }, h('span', { class: 'sc-eyebrow' }, evSource(c.evidence)), h('p', {}, `“${c.evidence.quote}”`), ...(c.evidence.url ? [h('a', { href: c.evidence.url, target: '_blank', rel: 'noopener' }, c.evidence.ref ?? 'Open project')] : [])));
    }
    else {
        body.append(h('p', { class: 'sc-noev mt-2 t-secondary' }, 'No verifiable evidence in the CV.'));
    }
    if (c.note)
        body.append(h('p', { class: 't-caption mt-2' }, c.note));
    const d = h('details', { class: 'sc-tile', 'data-grade': String(c.grade) }, h('summary', {}, h('span', { class: 'sc-tile-grade' }, String(c.grade)), h('span', { class: 'sc-tile-main' }, h('span', { class: 'sc-tile-title' }, c.title), h('span', { class: 't-caption' }, `${c.label} · ${c.priority === 'must' ? 'must have' : 'nice to have'}`))), body);
    return d;
}
function githubPanel(g) {
    const panel = h('section', { class: 'panel mt-6', 'aria-label': 'GitHub evidence' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, `GitHub evidence: @${g.username}`), stamp(g.verified ? 'Verified' : 'Claimed, not verified', g.verified ? 'confirmed' : 'claimed')), h('p', { class: 't-secondary' }, `${g.repos} own repositories, ${g.mergedPrs} merged pull requests elsewhere, active in ${g.activeMonths} of the last 12 months${g.languages.length ? `. Languages: ${g.languages.join(', ')}` : ''}.`));
    const rows = g.requirements.filter(q => q.findings.length);
    if (!rows.length)
        panel.append(h('p', { class: 't-caption mt-2' }, 'None of the public projects match a requirement from this job description.'));
    for (const q of rows) {
        const ul = h('ul', { class: 'readout-list mt-1' });
        for (const f of q.findings) {
            ul.append(h('li', {}, h('a', { href: f.url, target: '_blank', rel: 'noopener' }, f.name), h('span', { class: 't-caption' }, f.detail)));
        }
        panel.append(h('div', { class: 'mt-4' }, h('h3', { class: 't-body' }, `${q.title}${q.strong ? '' : ' (partial match)'}`), ...(q.note ? [h('p', { class: 't-caption' }, q.note)] : []), ul));
    }
    panel.append(h('p', { class: 't-caption mt-4' }, 'Public repository metadata only. Project code is not read, so this shows what exists, not how good it is.'));
    return panel;
}
