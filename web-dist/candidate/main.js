/* Candidate app. The accelerator journey, gated server-side:
   onboarding -> research -> role-by-role resume -> CV -> LinkedIn -> interview. */
import { api, subscribe } from '../shared/api.js';
import { h, mark, stamp, toast, empty, clear, checkGlyph, lockGlyph, setWidthPct, icon, railHead, railFoot, topbar, setCrumbs, setCrumbRoot, viewHeader, passwordScreen, uploadDocument, filePicker, DOCUMENT_ERRORS } from '../shared/dom.js';
/* Self-hosted vendor bundle (ADR-0018). The CDN import map was an inline
   script, which the CSP's script-src blocks, and one unresolvable specifier
   killed the whole module graph before any app code ran. The bundle is
   fully self-contained, so a single file suffices. */
import { Room, RoomEvent, createLocalAudioTrack } from '../vendor/livekit-client.esm.mjs';
import { cvBlocks } from '../shared/cv-template.js';
import { buildCvPdf } from '../shared/pdf.js';
import { buildCvDocx } from '../shared/docx.js';
let me;
let journey = null;
let view = 'dashboard';
let run = null;
let chat = [];
let activeRoleKey = null;
/* True only while a consented, verified session is actually recording. */
let verified = false;
let voiceCleanup = null;
/* True only while a turn request is actually in flight. This is the one
   truthful "the interviewer is responding" signal available: there is no
   real speech synthesis yet, so the voice console never claims audio is
   playing, only that a request is or isn't outstanding. */
let awaitingReply = false;
let roleExpanded = true;
const root = document.getElementById('root');
async function boot() {
    try {
        me = await api.get('/api/me');
        if (me.user.role !== 'candidate') {
            location.href = '/app/recruiter';
            return;
        }
        setCrumbRoot(me.tenantName);
    }
    catch {
        location.href = '/login';
        return;
    }
    if (me.user.mustChangePassword) {
        passwordScreen(root, me.user.displayName, () => location.reload());
        return;
    }
    await refreshJourney();
    /* The rail reads the record (target role label, To-Do count), so load it
       before the first shell render rather than after. */
    lastSelf = await api.get('/api/candidate/me').catch(() => null);
    renderShell();
    await renderView();
    subscribe(['task.changed', 'session.changed', 'artifact.changed', 'flow.complete', 'journey.changed'], async () => {
        await refreshJourney();
        renderShell();
        renderView();
    });
}
async function refreshJourney() {
    try {
        const resp = await api.get('/api/candidate/journey');
        journey = resp.journey;
    }
    catch { /* keep last known state */ }
}
function entitled(m) { return me.entitlements.includes(m); }
function openTasks() {
    return lastSelf?.tasks.length ?? 0;
}
let lastSelf = null;
const VIEW_LABEL = {
    dashboard: 'Dashboard', resume: 'My Resume', linkedin: 'LinkedIn', portfolios: 'Portfolio',
    interview: 'Interview', todo: 'To-Do',
};
/* Moves to a view the same way a rail click does. */
function go(id) {
    void stopVoice();
    view = id;
    run = null;
    chat = [];
    activeRoleKey = null;
    renderShell();
    void renderView();
}
function navItem(label, id, ico, opts = {}) {
    const b = h('button', { class: 'nav-item', 'aria-current': view === id ? 'page' : 'false', title: opts.locked ?? label });
    b.append(icon(ico), h('span', { class: 'lbl' }, label));
    if (opts.badge !== undefined && opts.badge > 0)
        b.append(h('span', { class: 'nav-badge' }, String(opts.badge)));
    /* A locked item still opens its page, which says what unlocks it and
       links to the step that does. A disabled-looking item that only toasts
       reads as broken. */
    if (opts.locked) {
        b.append(h('span', { class: 'nav-lock', title: opts.locked }, lockGlyph()));
        b.append(h('span', { class: 'sr-only' }, `, locked. ${opts.locked}`));
    }
    if (opts.module && !entitled(opts.module)) {
        b.setAttribute('aria-disabled', 'true');
        return b;
    }
    b.addEventListener('click', () => { go(id); opts.onOpen?.(); });
    return b;
}
function renderShell() {
    clear(root);
    const j = journey;
    const app = h('div', { class: 'app' });
    const rail = h('aside', { class: 'rail' }, railHead('Candidate'));
    const nav = h('nav', { class: 'nav', 'aria-label': 'Candidate' });
    const onboardingPending = !j || j.onboarding !== 'complete';
    nav.append(navItem(onboardingPending ? 'Get started' : 'Dashboard', 'dashboard', 'dashboard', { module: 'journey' }));
    /* Target role group with its document sections. */
    const group = h('button', { class: 'nav-group', 'aria-expanded': roleExpanded ? 'true' : 'false' });
    const chev = h('svg', { class: 'chev', viewBox: '0 0 16 16' });
    const chevPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chevPath.setAttribute('d', 'M4 6l4 4 4-4');
    chev.append(chevPath);
    group.append(chev, h('span', { class: 'lbl' }, lastSelf?.targetRole || 'Target role'));
    group.addEventListener('click', () => {
        roleExpanded = !roleExpanded;
        group.setAttribute('aria-expanded', roleExpanded ? 'true' : 'false');
        children.hidden = !roleExpanded;
    });
    const children = h('div', { class: 'nav-children' });
    const resumeLocked = onboardingPending || (j ? j.research !== 'complete' : true);
    children.append(navItem('My Resume', 'resume', 'resume', {
        module: 'resume_studio',
        locked: resumeLocked ? 'Complete your setup and the research step first' : undefined,
    }), navItem('LinkedIn', 'linkedin', 'linkedin', {
        module: 'linkedin_studio',
        locked: j?.linkedin === 'locked' ? (j.unlockNotes['linkedin'] ?? 'Locked') : undefined,
    }), navItem('Portfolio', 'portfolios', 'portfolios'));
    children.hidden = !roleExpanded;
    nav.append(group, children);
    /* Practice opens after research; the item is locked only before that. */
    nav.append(navItem('Interview', 'interview', 'interview', {
        module: 'practice',
        locked: j && j.practice === 'locked' ? (j.unlockNotes['practice'] ?? 'Locked') : undefined,
    }));
    nav.append(navItem('To-Do', 'todo', 'todo', { badge: openTasks() }));
    rail.append(nav, railFoot(me.user.displayName, 'Candidate'));
    /* The recording indicator lives in the topbar, visible on every view. */
    const main = h('main', {}, topbar([h('span', { id: 'recSlot' })]), h('div', { class: 'content', id: 'content' }));
    app.append(rail, main);
    root.append(app);
    paintRecording();
}
/* Voice room lifecycle. Cleanup is always callable: withdrawal, navigation,
   mode switches and unload all route through it, so the microphone never
   keeps publishing after consent or attention moves on (ADR-0020). */
async function stopVoice() {
    if (voiceCleanup)
        await voiceCleanup();
    verified = false;
    paintRecording();
}
function paintRecording() {
    const slot = document.getElementById('recSlot');
    const live = document.getElementById('live');
    if (!slot)
        return;
    slot.replaceChildren();
    if (verified) {
        slot.append(h('span', { class: 'recording' }, h('span', { class: 'recording-dot' }), 'Recording'));
        if (live)
            live.textContent = 'Recording started. This verified session is shared with your recruiter.';
    }
    else if (live) {
        live.textContent = 'Recording stopped.';
    }
}
async function renderView() {
    const content = document.getElementById('content');
    if (!content)
        return;
    clear(content);
    lastSelf = await api.get('/api/candidate/me').catch(() => lastSelf);
    const onboarding = !journey || journey.onboarding !== 'complete';
    setCrumbs([{ label: onboarding ? 'Get started' : (VIEW_LABEL[view] ?? 'Dashboard') }]);
    try {
        if (!journey || journey.onboarding !== 'complete') {
            await renderOnboarding(content);
            return;
        }
        if (view === 'dashboard')
            await renderDashboard(content);
        else if (view === 'todo')
            await renderTodo(content);
        else if (view === 'resume')
            await renderResume(content);
        else if (view === 'linkedin')
            await renderLinkedin(content);
        else if (view === 'portfolios')
            await renderPortfolio(content);
        else if (view === 'interview')
            await renderInterview(content);
    }
    catch (e) {
        content.append(empty('Something failed to load. Try again.'));
        console.error(e);
    }
}
function latestDoc(kind) {
    const a = lastSelf?.artifacts.filter(x => x.kind === kind).at(-1);
    return a ? { title: a.title, fields: a.fields, source: (a.fields.source ?? {}) } : null;
}
function provenance(src, createdBy) {
    const who = src.uploadedByRole === 'candidate' ? 'you' : (src.uploadedBy ?? createdBy);
    const when = src.uploadedAt ? `, ${src.uploadedAt.slice(0, 10)}` : '';
    return `${src.filename ?? (src.pasted ? 'Pasted text' : 'On file')} · added by ${who}${when}`;
}
/* What the parser read from the CV, so the candidate can catch a bad read
   once, here, instead of discovering it in every later step. */
function cvReadout(fields) {
    const roles = (fields.roles ?? []);
    const box = h('div', { class: 'readout' });
    if (!roles.length) {
        box.append(h('p', { class: 't-secondary' }, 'We could not find any roles with dates in this file. Check that each role has a start and end date (for example "Jan 2020 to Present"), then upload it again.'));
        return box;
    }
    box.append(h('p', { class: 't-caption' }, `We read ${roles.length} ${roles.length === 1 ? 'role' : 'roles'}. If any line is wrong, fix the file and upload it again.`));
    const list = h('ul', { class: 'readout-list' });
    for (const r of roles) {
        const n = Array.isArray(r.bullets) ? r.bullets.length : r.bullets;
        list.append(h('li', {}, h('span', { class: 't-body' }, [r.title, r.company].filter(Boolean).join(', ') || 'Untitled role'), h('span', { class: 't-caption figures' }, `${r.start} to ${r.end} · ${n} ${n === 1 ? 'bullet' : 'bullets'}`)));
    }
    box.append(list);
    return box;
}
async function renderOnboarding(content) {
    const self = lastSelf;
    content.append(viewHeader('Get started', `Welcome, ${self.name}. Add your CV once; every later step reuses it. Research runs as soon as you start.`));
    const panel = h('div', { class: 'panel mt-6 w-720 onboard' });
    const refresh = async () => { lastSelf = await api.get('/api/candidate/me').catch(() => lastSelf); await renderView(); };
    const fail = (e) => toast(DOCUMENT_ERRORS[String(e.message)] ?? 'That did not work. Try again.');
    /* 1. CV: upload once. If the recruiter already added it, it is reused. */
    const cv = latestDoc('resume');
    const cvSec = h('section', { class: 'onboard-step' }, h('h2', { class: 't-section' }, 'Your CV'));
    if (cv) {
        cvSec.append(h('div', { class: 'docline' }, mark('confirmed'), h('span', { class: 't-secondary' }, provenance(cv.source, 'your recruiter')), filePicker('Replace', async (f) => { try {
            await uploadDocument('/api/candidate/documents', 'resume', f);
            toast('CV replaced');
            await refresh();
        }
        catch (e) {
            fail(e);
        } })));
        cvSec.append(cvReadout(cv.fields));
    }
    else {
        cvSec.append(h('p', { class: 't-secondary' }, 'Upload your current CV as a PDF or Word file. We read it once and reuse it for research, your resume, your CV and LinkedIn.'), h('div', { class: 'mt-3' }, filePicker('Upload CV', async (f) => {
            try {
                const res = await uploadDocument('/api/candidate/documents', 'resume', f);
                toast(`Read ${res.read.roles.length} roles from ${f.name}`);
                await refresh();
            }
            catch (e) {
                fail(e);
            }
        }, { primary: true })));
    }
    panel.append(cvSec);
    /* 2. The role you are going for. The recruiter's target and job
       description win when they exist; the candidate is not asked again. */
    const jdDoc = latestDoc('jd');
    const tSec = h('section', { class: 'onboard-step' }, h('h2', { class: 't-section' }, 'The role'));
    const recruiterTarget = !!self.targetCompany;
    const company = h('input', { type: 'text', id: 'ob-company', placeholder: 'e.g. Ledgerline', value: self.targetCompany ?? '' });
    const role = h('input', { type: 'text', id: 'ob-role', placeholder: 'e.g. Senior Software Engineer', value: self.targetRole === 'Target role' ? '' : self.targetRole });
    if (recruiterTarget) {
        tSec.append(h('div', { class: 'docline' }, mark('confirmed'), h('span', { class: 't-secondary' }, `${self.targetRole} at ${self.targetCompany} · set by your recruiter`)));
    }
    else {
        tSec.append(h('div', { class: 'field' }, h('label', { for: 'ob-company' }, 'Target company'), company), h('div', { class: 'field' }, h('label', { for: 'ob-role' }, 'Target role'), role));
    }
    if (jdDoc) {
        const musts = (jdDoc.fields.mustHave ?? []).length;
        tSec.append(h('div', { class: 'docline' }, mark('confirmed'), h('span', { class: 't-secondary' }, `Job description · ${provenance(jdDoc.source, 'your recruiter')}${musts ? ` · ${musts} must-haves found` : ''}`)));
    }
    else {
        const jd = h('textarea', { rows: '6', id: 'ob-jd', placeholder: 'Paste the job description' });
        const saveJd = h('button', { class: 'btn' }, 'Save job description');
        saveJd.addEventListener('click', async () => {
            if (!jd.value.trim()) {
                toast('Paste the job description first.');
                return;
            }
            try {
                await api.post('/api/candidate/documents', { kind: 'jd', text: jd.value });
                toast('Job description saved');
                await refresh();
            }
            catch (e) {
                fail(e);
            }
        });
        tSec.append(h('div', { class: 'field' }, h('label', { for: 'ob-jd' }, 'Job description'), h('span', { class: 't-caption' }, 'Paste it, or upload the file.'), jd), h('div', { class: 'row gap-2' }, saveJd, filePicker('Upload file', async (f) => { try {
            await uploadDocument('/api/candidate/documents', 'jd', f);
            toast('Job description saved');
            await refresh();
        }
        catch (e) {
            fail(e);
        } })));
    }
    panel.append(tSec);
    /* 3. LinkedIn. The URL is enough to start; the profile text is what lets
       the date cross-check run, and the copy says so. */
    const liSec = h('section', { class: 'onboard-step' }, h('h2', { class: 't-section' }, 'LinkedIn'));
    const liUrl = h('input', { type: 'text', id: 'ob-li', placeholder: 'https://www.linkedin.com/in/...' });
    const liText = h('textarea', { rows: '4', id: 'ob-litext', placeholder: 'Optional: paste the text of your LinkedIn profile' });
    liSec.append(h('div', { class: 'field' }, h('label', { for: 'ob-li' }, 'Profile URL'), liUrl), h('div', { class: 'field' }, h('label', { for: 'ob-litext' }, 'Profile text (optional)'), h('span', { class: 't-caption' }, 'With it, we check your LinkedIn dates against your CV before your recruiter submits you.'), liText));
    panel.append(liSec);
    const ready = !!cv && !!jdDoc;
    const submit = h('button', { class: 'btn btn-primary', 'aria-disabled': ready ? 'false' : 'true' }, 'Start research');
    submit.addEventListener('click', async () => {
        if (submit.getAttribute('aria-disabled') === 'true') {
            toast(!cv ? 'Upload your CV first.' : 'Add the job description first.');
            return;
        }
        submit.setAttribute('aria-disabled', 'true');
        try {
            await api.post('/api/candidate/onboarding', {
                targetCompany: company.value, targetRole: role.value, linkedinUrl: liUrl.value, linkedinText: liText.value,
            });
            toast('Research complete. Your report is ready.');
            await refreshJourney();
            view = 'dashboard';
            renderShell();
            await renderView();
        }
        catch (e) {
            const msg = {
                company_required: 'Add the company you are applying to.', linkedin_required: 'Add your LinkedIn URL or profile text.',
                linkedin_url_invalid: 'The LinkedIn URL should start with https://', resume_required: 'Upload your CV first.', jd_required: 'Add the job description first.',
            };
            toast(msg[String(e.message)] ?? 'That did not work. Try again.');
            submit.setAttribute('aria-disabled', 'false');
        }
    });
    panel.append(h('div', { class: 'onboard-foot' }, h('p', { class: 't-caption' }, 'Documents pass the quarantine pipeline first. Embedded instructions are stripped, never executed.'), submit));
    content.append(panel);
}
/* ---------- CV downloads: template-rendered PDF and DOCX, built client
   side from the same structured fields, no server round trip ---------- */
function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}
function cvDownloads(name, cv) {
    const fields = cv.fields;
    const filenameBase = name.replace(/\s+/g, '-');
    const wrap = h('div', { class: 'd-flex gap-2 mt-3' });
    const pdfBtn = h('button', { class: 'btn btn-primary' }, 'Download PDF');
    pdfBtn.addEventListener('click', () => downloadBlob(buildCvPdf(cvBlocks(name, fields)), `${filenameBase}-CV.pdf`));
    const docxBtn = h('button', { class: 'btn' }, 'Download DOCX');
    docxBtn.addEventListener('click', () => downloadBlob(buildCvDocx(cvBlocks(name, fields)), `${filenameBase}-CV.docx`));
    wrap.append(pdfBtn, docxBtn);
    return wrap;
}
/* ---------- dashboard ---------- */
/* Findings spend colour on evidence only: covered is positive, partial is a
   warning, not evidenced blocks. */
const FINDING_META = {
    good: { hue: 'green', word: 'Good' },
    improve: { hue: 'orange', word: 'Improve' },
    needs_work: { hue: 'red', word: 'Needs work' },
};
function findingCard(f) {
    const meta = FINDING_META[f.kind] ?? FINDING_META.needs_work;
    return h('div', { class: `finding ${f.kind}` }, h('div', { class: 'finding-head' }, h('span', { class: `chip-pastel ${meta.hue}` }, meta.word), h('span', { class: 't-section' }, f.title)), h('p', { class: 't-body' }, f.detail));
}
/* The one thing to do next, derived from the same journey state as the
   stepper, so the two can never disagree. */
function nextStep(j, nowIndex) {
    if (nowIndex === 1)
        return { title: 'Research is pending', text: 'Your report appears here as soon as the research step runs.' };
    if (nowIndex === 2)
        return { title: 'Revamp your roles', text: `${j.roles.filter(r => r.done).length} of ${j.roles.length} roles done. Each role gets its own session.`, view: 'resume', label: 'Open My Resume' };
    if (nowIndex === 3)
        return { title: 'Your CV is assembling', text: 'It is built from your completed roles.', view: 'resume', label: 'Open My Resume' };
    if (nowIndex === 4)
        return { title: 'Your LinkedIn studio is ready', text: 'Generate each section from your finished resume. Titles and dates always match.', view: 'linkedin', label: 'Open LinkedIn studio' };
    if (nowIndex === 5)
        return { title: 'The verified interview is next', text: `${j.unlockNotes['interview'] ?? 'It unlocks once your CV and LinkedIn are complete.'} Private practice is open now.`, view: 'interview', label: 'Practice now' };
    return { title: 'Every stage is complete', text: 'Practice privately, or run a verified session for your recruiter.', view: 'interview', label: 'Open Interview' };
}
async function renderDashboard(content) {
    const self = lastSelf;
    const j = journey;
    content.append(viewHeader('Dashboard', `Target: ${self.targetRole}${self.targetCompany ? ` at ${self.targetCompany}` : ''}.`));
    /* Journey progress strip. */
    const steps = [
        ['Setup', j.onboarding === 'complete' ? 'Complete' : 'Pending', j.onboarding === 'complete'],
        ['Research', j.research === 'complete' ? 'Complete' : 'Pending', j.research === 'complete'],
        ['Resume', j.roles.length ? (j.rolesDone ? 'Complete' : `${j.roles.filter(r => r.done).length} / ${j.roles.length} roles`) : 'Pending', j.rolesDone],
        ['CV', j.cv === 'complete' ? 'Complete' : 'Pending', j.cv === 'complete'],
        ['LinkedIn', j.linkedin === 'complete' ? 'Complete' : j.linkedin === 'unlocked' ? 'Ready' : 'Locked', j.linkedin === 'complete'],
        ['Interview', j.interview === 'unlocked' ? 'Ready' : 'Locked', j.interview === 'unlocked'],
    ];
    /* A gated chain reads as a chain: one node per stage, connected, with the
       first incomplete stage marked as where the candidate stands now. */
    const strip = h('ol', { class: 'journey', 'aria-label': 'Your progress' });
    const nowIndex = steps.findIndex(([, , done]) => !done);
    steps.forEach(([label, cap, done], i) => {
        const state = done ? 'is-done' : i === nowIndex ? 'is-now' : 'is-locked';
        const node = h('span', { class: 'jnode', 'aria-hidden': 'true' });
        if (done)
            node.append(checkGlyph());
        else
            node.append(document.createTextNode(String(i + 1)));
        strip.append(h('li', { class: `jstep ${state}` }, h('span', { class: 'jrail' }, node), h('span', { class: 'jlabel' }, label), h('span', { class: 'jcap' }, cap), 
        /* The visual state is carried by colour and position, so name it. */
        h('span', { class: 'sr-only' }, done ? ' (complete)' : i === nowIndex ? ' (current stage)' : ' (locked)')));
    });
    const progress = h('section', { class: 'panel mt-6', 'aria-label': 'Your progress' }, strip);
    const next = nextStep(j, nowIndex);
    const nextBox = h('div', { class: 'nextstep' }, h('div', { class: 'nextstep-text' }, h('h2', { class: 't-section' }, next.title), h('p', { class: 't-secondary' }, next.text)));
    if (next.view && next.label) {
        const target = next.view;
        const b = h('button', { class: 'btn btn-primary' }, next.label, icon('arrow'));
        b.addEventListener('click', () => go(target));
        nextBox.append(b);
    }
    progress.append(nextBox);
    content.append(progress);
    const grid = h('div', { class: 'grid2 mt-6' });
    /* Research report. */
    const report = h('div', { class: 'panel' });
    const reportHead = h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Research report'));
    report.append(reportHead);
    if (!j.findings.length) {
        report.append(empty('The research step has not run yet.'));
    }
    else {
        const counts = { good: 0, improve: 0, needs_work: 0 };
        for (const f of j.findings)
            counts[f.kind]++;
        reportHead.append(h('span', { class: 't-caption figures' }, `${counts.good} good · ${counts.improve} to improve · ${counts.needs_work} needs work`));
        for (const f of j.findings)
            report.append(findingCard(f));
    }
    grid.append(report);
    /* Deliverables and sessions. */
    const right = h('div', { class: 'stack-y' });
    const cv = self.artifacts.filter(a => a.kind === 'cv').at(-1);
    const del = h('div', { class: 'panel' });
    del.append(h('h2', { class: 't-section' }, 'Deliverables'));
    if (cv?.content) {
        del.append(h('p', { class: 't-body' }, 'Your revamped CV is ready.'));
        del.append(cvDownloads(self.name, cv));
    }
    else {
        del.append(empty('Your CV is assembled once every role in My Resume is complete.'));
    }
    right.append(del);
    const sess = h('div', { class: 'panel' });
    sess.append(h('h2', { class: 't-section' }, 'Sessions'));
    if (!self.sessions.length)
        sess.append(empty('No sessions yet.'));
    for (const s of self.sessions) {
        sess.append(h('div', { class: 'srow' }, h('div', {}, h('div', { class: 't-secondary' }, `${s.mode === 'verified' ? 'Verified' : 'Practice'} session · ${s.date}`), s.star
            ? h('div', { class: 't-caption figures', title: 'Share of your answers spent on Situation, Task, Action and Result' }, `Situation ${s.star.S}% · Task ${s.star.T}% · Action ${s.star.A}% · Result ${s.star.R}%`)
            : h('div', { class: 't-caption' }, s.status))));
    }
    right.append(sess);
    right.append(await profileCard());
    grid.append(right);
    content.append(grid);
}
/* ---------- resume studio: role list and per-role session ---------- */
async function renderResume(content) {
    const j = journey;
    content.append(viewHeader('My Resume', 'One role per session, in depth. Each role gets its own interviewer.'));
    if (j.research !== 'complete') {
        content.append(lockedNote(j.unlockNotes['resume'] ?? 'My Resume opens once your research report is ready.', 'dashboard', 'Go to dashboard'));
        return;
    }
    if (run && activeRoleKey) {
        const role = j.roles.find(r => r.key === activeRoleKey);
        const panel = h('div', { class: 'panel mt-6' });
        panel.append(h('h2', { class: 't-section' }, `${role?.title ?? 'Role'} · ${role?.company ?? ''}`));
        const log = h('div', { class: 'chatlog mt-3' });
        for (const m of chat) {
            log.append(h('div', { class: 'turn plain' }, h('div', {}, h('span', { class: 'who' }, m.who), h('span', { class: 't-body' }, m.text))));
        }
        panel.append(log);
        if (run.status === 'complete') {
            const self = lastSelf;
            const handoff = self.artifacts.filter(a => a.kind === 'handoff_block').at(-1);
            if (handoff?.content) {
                panel.append(h('h2', { class: 't-section mt-6' }, 'Your bullets for this role'));
                panel.append(h('div', { class: 'handoff' }, handoff.content));
                /* Nothing to copy: these go straight into the assembled CV. */
                panel.append(h('p', { class: 't-caption mt-3 row gap-2' }, mark('confirmed'), 'Added to your CV automatically.'));
            }
            const back = h('button', { class: 'btn btn-primary mt-3 ml-2' }, 'Back to roles');
            back.addEventListener('click', async () => { run = null; chat = []; activeRoleKey = null; await refreshJourney(); await renderView(); });
            panel.append(back);
        }
        else if (run.status === 'failed') {
            panel.append(empty(`The step failed: ${run.error ?? 'unknown'}. Start a fresh session for this role.`));
        }
        else {
            const input = h('input', { type: 'text', placeholder: 'Type your answer', 'aria-label': 'Your answer' });
            const send = h('button', { class: 'btn btn-primary ml-2' }, 'Send');
            send.addEventListener('click', async () => {
                const text = input.value.trim();
                if (!text)
                    return;
                chat.push({ who: 'You', text });
                input.value = '';
                try {
                    const resp = await api.post(`/api/flows/runs/${run.id}/turn`, { text });
                    chat.push({ who: 'Interviewer', text: resp.reply });
                    run = resp.run;
                    if (resp.run.status === 'complete') {
                        await refreshJourney();
                        await renderShell();
                    }
                }
                catch (e) {
                    chat.push({ who: 'Certainty', text: String(e.message) });
                }
                await renderView();
            });
            input.addEventListener('keydown', e => { if (e.key === 'Enter')
                send.click(); });
            panel.append(h('div', { class: 'd-flex mt-4' }, input, send));
        }
        content.append(panel);
        return;
    }
    const panel = h('div', { class: 'panel mt-6 w-720' });
    if (!j.roles.length) {
        panel.append(empty('No roles found in your resume yet.'));
    }
    for (const role of j.roles) {
        const row = h('div', { class: 'srow' }, h('div', {}, h('div', { class: 't-body' }, `${role.title} · ${role.company}`), h('div', { class: 't-caption' }, role.done ? 'Complete' : 'Not started')), role.done ? stamp('Done', 'confirmed') : (() => {
            const b = h('button', { class: 'btn btn-sm btn-primary' }, 'Start');
            b.addEventListener('click', async () => {
                try {
                    const resp = await api.post('/api/candidate/flows/resume_studio/start', { roleKey: role.key });
                    run = resp.run;
                    activeRoleKey = role.key;
                    const first = await api.post(`/api/flows/runs/${run.id}/turn`, { text: '' });
                    chat = [{ who: 'Interviewer', text: first.reply }];
                    run = first.run;
                    await renderView();
                }
                catch (e) {
                    toast(String(e.message));
                }
            });
            return b;
        })());
        panel.append(row);
    }
    content.append(panel);
    const cv = lastSelf.artifacts.filter(a => a.kind === 'cv').at(-1);
    if (cv?.content) {
        const cvPanel = h('div', { class: 'panel mt-6 w-720' });
        cvPanel.append(h('h2', { class: 't-section' }, 'Revamped CV'));
        cvPanel.append(h('div', { class: 'handoff' }, cv.content));
        cvPanel.append(cvDownloads(lastSelf.name, cv));
        content.append(cvPanel);
    }
}
function lowerFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
/* A locked page says what unlocks it and links to the step that does. */
function lockedNote(note, target, label) {
    return h('div', { class: 'mt-6' }, empty(note, { label, fn: () => go(target) }));
}
/* ---------- linkedin: six saved sections, not a chat ---------- */
const LI_SECTIONS = [
    ['banner', 'Banner'], ['headline', 'Headline'], ['about', 'About'],
    ['experience', 'Experience'], ['keywords', 'Keywords'], ['skills', 'Skills'],
];
let liBusy = false;
function liSections() {
    const a = lastSelf?.artifacts.filter(x => x.kind === 'linkedin_sections').at(-1);
    const f = (a?.fields ?? {});
    return { runId: f.runId ?? null, sections: f.sections ?? {} };
}
/* The section text without the agent's own heading line. */
function sectionBody(text) {
    return text.replace(/^[^:\n]{2,60}:\s*/, '').trim();
}
async function generateLinkedin(keys, restart) {
    if (liBusy)
        return;
    liBusy = true;
    try {
        let runId = restart ? null : liSections().runId;
        if (!runId || restart) {
            const resp = await api.post('/api/candidate/flows/linkedin_studio/start');
            runId = resp.run.id;
        }
        for (const key of keys) {
            await api.post(`/api/flows/runs/${runId}/turn`, { text: key });
            lastSelf = await api.get('/api/candidate/me').catch(() => lastSelf);
            await renderView();
        }
        await refreshJourney();
        renderShell();
        toast('LinkedIn sections saved');
    }
    catch (e) {
        const code = String(e.message);
        toast(code === 'active_session_exists' ? 'A LinkedIn session is still running. Reload the page and try again.' : 'Could not write the sections. Try again.');
    }
    finally {
        liBusy = false;
        await renderView();
    }
}
async function renderLinkedin(content) {
    const j = journey;
    content.append(viewHeader('LinkedIn', 'Six sections written from your finished resume. Titles and dates always match it.'));
    if (j.linkedin === 'locked') {
        content.append(lockedNote(j.unlockNotes['linkedin'] ?? 'LinkedIn opens once your resume is complete.', 'resume', 'Open My Resume'));
        return;
    }
    const { sections } = liSections();
    const missing = LI_SECTIONS.map(([k]) => k).filter(k => !sections[k]);
    const acts = h('div', { class: 'row gap-2 wrap mt-6' });
    if (missing.length) {
        const gen = h('button', { class: 'btn btn-primary', 'aria-disabled': liBusy ? 'true' : 'false' }, liBusy ? 'Writing your sections' : missing.length === 6 ? 'Write all six sections' : `Write the remaining ${missing.length}`);
        gen.addEventListener('click', () => { void generateLinkedin(missing, false); });
        acts.append(gen);
    }
    else {
        const again = h('button', { class: 'btn', 'aria-disabled': liBusy ? 'true' : 'false' }, 'Write them again');
        again.addEventListener('click', () => { void generateLinkedin(LI_SECTIONS.map(([k]) => k), true); });
        acts.append(h('span', { class: 't-secondary row gap-2' }, mark('confirmed'), 'All six saved. Copy each into your LinkedIn profile.'), again);
    }
    content.append(acts);
    const grid = h('div', { class: 'cardgrid mt-6' });
    for (const [key, label] of LI_SECTIONS) {
        const text = sections[key];
        const card = h('section', { class: `panel li-card${text ? '' : ' is-pending'}`, 'aria-label': label });
        const head = h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, label));
        if (text) {
            const copy = h('button', { class: 'btn btn-sm' }, icon('copy', 14), 'Copy');
            copy.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(sectionBody(text));
                    toast(`${label} copied`);
                }
                catch {
                    toast('Select the text and copy it manually');
                }
            });
            head.append(copy);
            card.append(head, h('div', { class: 'li-body' }, sectionBody(text)));
        }
        else {
            card.append(head, h('p', { class: 't-caption' }, liBusy ? 'Writing...' : 'Not written yet.'));
        }
        grid.append(card);
    }
    content.append(grid);
}
const CONNECTOR_META = {
    github: { name: 'GitHub', reads: 'your public repositories, languages and the pull requests merged into other projects.', bio: 'GitHub bio (Settings, Public profile, Bio)', placeholder: 'GitHub username or profile URL' },
    leetcode: { name: 'LeetCode', reads: 'problems solved by difficulty, contest rating and badges.', bio: 'LeetCode summary (Edit profile, Summary)', placeholder: 'LeetCode username or profile URL' },
};
const CONNECTOR_ERRORS = {
    account_not_found: 'No public account with that username.', invalid_username: 'That does not look like a username.',
    already_linked: 'That account type is already connected.', provider_rate_limited: 'The provider is busy. Try again in a few minutes.',
    provider_unreachable: 'Could not reach the provider. Try again shortly.', provider_error: 'The provider returned an error. Try again shortly.',
};
function connectorSummary(c) {
    const s = c.snapshot;
    const box = h('div', { class: 'conn-summary' });
    if (!s) {
        box.append(h('p', { class: 't-caption' }, 'Not synced yet.'));
        return box;
    }
    const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value));
    if (c.provider === 'github') {
        box.append(h('div', { class: 'statstrip' }, stat('Own repositories', String(s.repos.length)), stat('Merged PRs elsewhere', String(s.mergedPrs.length)), stat('Active months, last year', `${s.activeMonths}/12`)));
        if (s.languages.length)
            box.append(h('p', { class: 't-caption mt-3' }, `Languages: ${s.languages.slice(0, 6).map((l) => l.name).join(', ')}`));
        const list = h('ul', { class: 'readout-list mt-2' });
        for (const r of s.repos.slice(0, 3)) {
            list.append(h('li', {}, h('span', { class: 't-body' }, r.name), h('span', { class: 't-caption' }, [r.language, r.description].filter(Boolean).join(' · '))));
        }
        if (s.repos.length)
            box.append(list);
    }
    else {
        box.append(h('div', { class: 'statstrip' }, stat('Solved', String(s.solved.all)), stat('Easy / Medium / Hard', `${s.solved.easy} / ${s.solved.medium} / ${s.solved.hard}`), stat('Contest rating', s.contest ? String(s.contest.rating) : 'None')));
        if (s.badges.length)
            box.append(h('p', { class: 't-caption mt-3' }, `Badges: ${s.badges.join(', ')}`));
    }
    return box;
}
async function renderPortfolio(content) {
    content.append(viewHeader('Portfolio', 'Connect public accounts that show your work. A connected account counts as claimed; adding a one-time code to its bio proves it is yours and marks it verified.'));
    const { connectors } = await api.get('/api/candidate/connectors');
    const act = async (fn, ok) => {
        try {
            const res = await fn();
            toast(res?.syncError ? (CONNECTOR_ERRORS[res.syncError] ?? 'Connected, but the first sync failed. Try Sync.') : ok);
        }
        catch (e) {
            toast(CONNECTOR_ERRORS[String(e.message)] ?? 'That did not work. Try again.');
        }
        await renderView();
    };
    const grid = h('div', { class: 'cardgrid cardgrid-2 mt-6' });
    for (const c of connectors) {
        const meta = CONNECTOR_META[c.provider];
        const card = h('section', { class: 'panel conn-card', 'aria-label': meta.name });
        const head = h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, meta.name));
        card.append(head);
        if (!c.linked) {
            const input = h('input', { type: 'text', placeholder: meta.placeholder, 'aria-label': meta.placeholder });
            const connect = h('button', { class: 'btn btn-primary' }, 'Connect');
            connect.addEventListener('click', () => {
                if (!input.value.trim()) {
                    toast('Enter a username first.');
                    return;
                }
                void act(() => api.post(`/api/candidate/connectors/${c.provider}`, { username: input.value }), `${meta.name} connected`);
            });
            input.addEventListener('keydown', e => { if (e.key === 'Enter')
                connect.click(); });
            card.append(h('p', { class: 't-secondary' }, `We read: ${meta.reads}`), h('div', { class: 'row gap-2 mt-3' }, input, connect));
        }
        else {
            head.append(c.verified ? stamp('Verified', 'confirmed') : stamp('Claimed, not verified', 'claimed'));
            card.append(h('p', { class: 't-secondary' }, h('a', { href: c.url ?? '#', target: '_blank', rel: 'noopener' }, `@${c.username}`), c.syncedAt ? ` · synced ${c.syncedAt.slice(0, 10)}` : ''));
            if (!c.verified && c.code) {
                const copy = h('button', { class: 'btn btn-sm' }, 'Copy code');
                copy.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(c.code);
                        toast('Code copied');
                    }
                    catch {
                        toast('Select the code and copy it');
                    }
                });
                const check = h('button', { class: 'btn btn-sm btn-primary' }, 'Check now');
                check.addEventListener('click', () => void act(() => api.post(`/api/candidate/connectors/${c.provider}/sync`), 'Checked'));
                card.append(h('div', { class: 'verify-box' }, h('p', { class: 't-secondary' }, `To prove this account is yours, add this code anywhere in your ${meta.bio}, then press Check now. You can remove it afterwards.`), h('div', { class: 'row gap-2 wrap mt-2' }, h('code', { class: 'verify-code' }, c.code), copy, check)));
            }
            card.append(connectorSummary(c));
            const sync = h('button', { class: 'btn btn-sm' }, 'Sync');
            sync.addEventListener('click', () => void act(() => api.post(`/api/candidate/connectors/${c.provider}/sync`), 'Synced'));
            const off = h('button', { class: 'btn btn-sm btn-ghost' }, 'Disconnect');
            off.addEventListener('click', () => {
                if (!confirm(`Disconnect ${meta.name}? Its data is deleted from your profile.`))
                    return;
                void act(() => api.post(`/api/candidate/connectors/${c.provider}/disconnect`), `${meta.name} disconnected and its data deleted`);
            });
            card.append(h('div', { class: 'acts' }, sync, off));
        }
        grid.append(card);
    }
    content.append(grid);
}
/* ---------- profile page card (dashboard) ---------- */
async function profileCard() {
    const panel = h('div', { class: 'panel' }, h('h2', { class: 't-section' }, 'Your profile page'));
    const data = await api.get('/api/candidate/profile').catch(() => null);
    if (!data?.page) {
        panel.append(h('p', { class: 't-secondary' }, 'A one-page summary for the companies your recruiter submits you to. It is generated once every role is complete.'));
        return panel;
    }
    const page = data.page;
    const fit = data.insight?.fitSummary;
    if (fit && fit.total)
        panel.append(h('p', { class: 't-secondary' }, `Shows evidence for ${fit.evidenced} of ${fit.total} requirements, ${fit.verified} verified.`));
    panel.append(h('p', { class: 't-secondary mt-2' }, page.live
        ? `Shared. Your recruiter can send the link until ${page.share.expiresAt?.slice(0, 10)}.`
        : 'Not shared. Nothing goes to a company until you approve it.'));
    const preview = h('a', { class: 'btn', href: `/p/${page.id}`, target: '_blank', rel: 'noopener' }, 'Preview');
    const toggle = h('button', { class: page.live ? 'btn' : 'btn btn-primary' }, page.live ? 'Stop sharing' : 'Approve sharing');
    toggle.addEventListener('click', async () => {
        try {
            await api.post('/api/candidate/profile/share', { enabled: !page.live });
            toast(page.live ? 'Sharing stopped. The link no longer works.' : 'Approved for 30 days');
        }
        catch {
            toast('That did not work. Try again.');
        }
        await renderView();
    });
    panel.append(h('div', { class: 'row gap-2 wrap mt-3' }, toggle, preview));
    return panel;
}
/* ---------- to-do ---------- */
async function renderTodo(content) {
    const self = lastSelf;
    content.append(viewHeader('To-Do', 'Approved by your recruiter. Fix each one in your CV, then tell us; your recruiter checks it.', self.tasks.length > 0 ? [h('span', { class: 'todo-badge' }, `${self.tasks.length} open`)] : []));
    const list = h('div', { class: 'my-6 w-640' });
    if (!self.tasks.length)
        list.append(empty('Nothing on your list right now. Your CV and your interview answers line up.'));
    for (const t of self.tasks) {
        const card = h('div', { class: 'todo-card' });
        const header = h('header', { class: 'row gap-2 mb-2 wrap' }, mark(t.type === 'warn' ? 'conflict' : 'confirmed'), h('h3', { class: 't-section' }, t.title));
        if (t.source === 'recruiter')
            header.append(stamp('From your recruiter'));
        card.append(header, h('p', { class: 't-body' }, t.body));
        /* The candidate says it is fixed; the recruiter checks it against the
           CV. The wording claims only what the candidate can know. */
        const done = h('button', { class: 'btn btn-sm' }, 'I have fixed this');
        done.addEventListener('click', async () => {
            await api.post(`/api/candidate/tasks/${t.id}/done`);
            toast('Marked fixed. Your recruiter will check it against your CV.');
            await renderView();
        });
        card.append(h('div', { class: 'acts' }, done));
        list.append(card);
    }
    content.append(list);
}
/* ---------- interview: split screen ---------- */
async function renderInterview(content) {
    const j = journey;
    content.append(viewHeader('Interview', 'Practice is private. Verified sessions are shared with your recruiter.'));
    if (j.practice === 'locked') {
        content.append(lockedNote(j.unlockNotes['practice'] ?? 'Practice opens once your research report is ready.', 'dashboard', 'Go to dashboard'));
        return;
    }
    const verifiedLocked = j.interview === 'locked';
    const pane = h('div', { class: 'splitpane mt-6' });
    const left = h('div', { class: 'pane' });
    /* The toggle shows the mode actually in effect. Choosing Verified opens
       the consent dialog; the toggle moves only once consent exists, and
       cancelling leaves practice exactly as it was. */
    const seg = h('div', { class: 'modeseg', role: 'group', 'aria-label': 'Session mode' });
    const pB = h('button', { 'aria-pressed': verified ? 'false' : 'true' }, 'Practice · private');
    const vB = h('button', { 'aria-pressed': verified ? 'true' : 'false' }, verifiedLocked ? 'Verified · locked' : 'Verified · shared');
    if (verifiedLocked) {
        vB.setAttribute('aria-disabled', 'true');
        vB.prepend(lockGlyph(11));
    }
    seg.append(pB, vB);
    pB.addEventListener('click', async () => {
        if (!verified)
            return;
        await stopVoice();
        run = null;
        chat = [];
        renderView();
    });
    vB.addEventListener('click', () => {
        if (verified)
            return;
        if (verifiedLocked) {
            toast(j.unlockNotes['interview'] ?? 'The verified interview is locked.');
            return;
        }
        if (run && run.status !== 'complete' && !confirm('Leave this practice session and start a verified one?'))
            return;
        showConsentModal();
    });
    left.append(h('div', { class: 'row wrap gap-2' }, seg));
    left.append(h('p', { class: 't-caption my-3' }, verified
        ? 'Verified session. Recording, with your consent. Shared with your recruiter, gaps included.'
        : verifiedLocked
            ? `Practice mode. Only you see this session. The verified session unlocks later: ${lowerFirst((j.unlockNotes['interview'] ?? '').replace(/\.$/, ''))}.`
            : 'Practice mode. Only you see this session. Suggestions for improvement are yours to keep.'));
    if (!run) {
        if (verified) {
            left.append(empty('Verified sessions start with consent. Nothing records before it exists.', { label: 'Start verified session', fn: () => showConsentModal() }));
        }
        else {
            left.append(empty('Practice sessions are private and never visible to recruiters.', { label: 'Start practice session', fn: async () => {
                    try {
                        const resp = await api.post('/api/candidate/flows/interview_screener/start', { mode: 'practice' });
                        run = resp.run;
                        const first = await api.post(`/api/flows/runs/${run.id}/turn`, { text: '' });
                        chat = [{ who: 'Interviewer', text: first.reply }];
                        run = first.run;
                        await renderView();
                    }
                    catch (e) {
                        toast(String(e.message));
                    }
                } }));
        }
    }
    else if (verified && voiceCleanup) {
        /* Voice session live: no text input while the room is open. */
        left.append(h('div', { class: 'panel mt-3' }, h('span', { class: 'recording' }, h('span', { class: 'recording-dot' }), 'Recording'), h('p', { class: 't-body mt-3' }, 'The voice session is live in this browser. The interviewer hears you and the exchange is captured server-side, inside your consented session.'), (() => {
            const stop = h('button', { class: 'btn mt-3' }, 'Withdraw consent and stop');
            stop.addEventListener('click', async () => {
                const { consents } = await api.get('/api/candidate/consents');
                const active = consents.find(c => c.active);
                if (active)
                    await api.post(`/api/consents/${active.id}/withdraw`);
                await stopVoice();
                run = null;
                chat = [];
                toast('Consent withdrawn. Recording stopped and downstream artifacts flagged.');
                renderShell();
                await renderView();
            });
            return stop;
        })()));
    }
    else {
        const log = h('div', { class: 'chatlog' });
        for (const m of chat) {
            log.append(h('div', { class: 'turn plain' }, h('div', {}, h('span', { class: 'who' }, m.who), h('span', { class: 't-body' }, m.text))));
        }
        left.append(log);
        if (run.status === 'complete') {
            const deb = lastSelf.sessions.filter(s => s.debrief).at(-1);
            if (deb?.debrief)
                left.append(h('div', { class: 'handoff' }, deb.debrief));
            const again = h('button', { class: 'btn mt-4' }, 'New session');
            again.addEventListener('click', async () => { await stopVoice(); run = null; chat = []; renderView(); });
            left.append(again);
        }
        else if (run.status === 'failed') {
            left.append(empty(`The step failed: ${run.error ?? 'unknown'}. You can start a fresh session.`));
        }
        else {
            const input = h('input', { type: 'text', placeholder: 'Your answer', 'aria-label': 'Your answer' });
            const send = h('button', { class: 'btn btn-primary ml-2' }, 'Send');
            send.addEventListener('click', async () => {
                const text = input.value.trim();
                if (!text || awaitingReply)
                    return;
                chat.push({ who: 'You', text });
                input.value = '';
                awaitingReply = true;
                await renderView();
                try {
                    const resp = await api.post(`/api/flows/runs/${run.id}/turn`, { text });
                    chat.push({ who: 'Interviewer', text: resp.reply });
                    run = resp.run;
                    if (resp.run.status === 'complete') {
                        verified = false;
                        paintRecording();
                        lastSelf = await api.get('/api/candidate/me').catch(() => lastSelf);
                        const deb = lastSelf.sessions.filter(s => s.debrief).at(-1);
                        if (deb?.debrief)
                            chat.push({ who: 'Debrief', text: deb.debrief });
                    }
                }
                catch (e) {
                    chat.push({ who: 'Certainty', text: String(e.message) });
                }
                awaitingReply = false;
                await renderView();
            });
            input.addEventListener('keydown', e => { if (e.key === 'Enter')
                send.click(); });
            left.append(h('div', { class: 'd-flex mt-4' }, input, send));
            if (verified) {
                const stop = h('button', { class: 'btn mt-4' }, 'Withdraw consent and stop');
                stop.addEventListener('click', async () => {
                    const { consents } = await api.get('/api/candidate/consents');
                    const active = consents.find(c => c.active);
                    if (active) {
                        await api.post(`/api/consents/${active.id}/withdraw`);
                        await stopVoice();
                        toast('Consent withdrawn. Recording stopped and artifacts flagged.');
                        await renderView();
                    }
                    else
                        toast('No active consent record.');
                });
                left.append(stop);
            }
        }
    }
    pane.append(left, renderVoiceConsole(!!run));
    content.append(pane);
}
function consoleState(hasRun) {
    if (verified && voiceCleanup)
        return 'live';
    if (!hasRun)
        return 'ready';
    if (run?.status === 'complete' || run?.status === 'failed')
        return 'done';
    return awaitingReply ? 'thinking' : 'waiting';
}
const CONSOLE_LABEL = {
    ready: 'Text session, ready when you are', waiting: 'Your turn: type your answer', thinking: 'The interviewer is thinking',
    live: 'Live audio, recording with your consent', done: 'Session complete',
};
const CONSOLE_CLASS = {
    ready: 'idle', waiting: 'waiting', thinking: 'thinking', live: 'waiting', done: 'idle',
};
/* The mic glyph for the live-audio state. */
function micGlyph(size) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('aria-hidden', 'true');
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    body.setAttribute('d', 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z');
    const stand = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    stand.setAttribute('d', 'M19 11a7 7 0 01-14 0M12 18v3');
    svg.append(body, stand);
    return svg;
}
function renderVoiceConsole(hasRun) {
    const state = consoleState(hasRun);
    const orb = h('div', { class: `orb vstate-${CONSOLE_CLASS[state]}`, 'aria-hidden': 'true' }, state === 'live' ? micGlyph(38) : icon('notes', 34));
    const vlabel = h('div', { class: 'vlabel', role: 'status' }, CONSOLE_LABEL[state]);
    return h('div', { class: 'pane voicecol' }, orb, vlabel, starArea(hasRun));
}
/* The live STAR area: an honest placeholder while the run is active, the
   real scored proportions once the evaluator has actually run. */
function starArea(hasRun) {
    const completedSession = hasRun && run?.status === 'complete'
        ? lastSelf?.sessions.filter(s => s.star).at(-1)
        : undefined;
    if (!completedSession?.star) {
        return h('div', { class: 'starmini-empty' }, h('p', { class: 't-caption' }, 'STAR proportions score once this session completes.'));
    }
    const star = completedSession.star;
    const targets = { S: 15, T: 10, A: 50, R: 25 };
    const box = h('div', { class: 'starmini' });
    for (const k of ['S', 'T', 'A', 'R']) {
        const v = star[k] ?? 0;
        const track = h('div', { class: 'track' });
        track.append(setWidthPct(h('div', { class: 'fill' }), v));
        box.append(h('div', { class: 'row' }, h('span', {}, k), track, h('span', { class: 'figures' }, `${v}%`)));
    }
    box.append(h('p', { class: 't-caption mt-2' }, `Target ${targets.S}/${targets.T}/${targets.A}/${targets.R}`));
    return box;
}
function showConsentModal() {
    const scrim = h('div', { class: 'scrim' });
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mTitle' });
    modal.append(h('h2', { class: 't-view', id: 'mTitle' }, 'Verified session'));
    modal.append(h('p', { class: 't-secondary' }, 'Your consent is required before anything is recorded.'));
    modal.append(h('ul', {}, h('li', {}, 'Audio and transcript are recorded'), h('li', {}, 'Shared with your connected recruiter'), h('li', {}, 'Used as screening evidence in your submission'), h('li', {}, 'You can access, export, or delete recordings anytime'), h('li', {}, 'You can withdraw consent at any time')));
    const ck = h('input', { type: 'checkbox', id: 'ck' });
    modal.append(h('label', { class: 'chk' }, ck, h('span', {}, 'I understand and consent to recording and sharing')));
    const ok = h('button', { class: 'btn btn-primary', 'aria-disabled': 'true' }, 'Start verified session');
    ck.addEventListener('change', () => ok.setAttribute('aria-disabled', ck.checked ? 'false' : 'true'));
    ok.addEventListener('click', async () => {
        if (ok.getAttribute('aria-disabled') === 'true')
            return;
        try {
            /* L4 chain, all server-enforced (ADR-0020): start the screener flow
               (it parks at the consent gate), grant consent (a ConsentRecord is
               stored and the verified session is created), and only then mint a
               room token. The token endpoint refuses any request without the
               chain, and the webhook refuses ingestion outside an active
               consented session. */
            const started = await api.post('/api/candidate/flows/interview_screener/start', { mode: 'verified' });
            run = started.run;
            const granted = await api.post(`/api/flows/runs/${run.id}/consent`, { scope: 'recording and sharing' });
            run = granted.run;
            let tokenResp;
            try {
                tokenResp = await api.post('/api/candidate/livekit/token', { runId: run.id });
            }
            catch (err) {
                if (String(err.message) !== 'livekit_not_configured')
                    throw err;
                /* No audio provider on this deployment: the consented session runs
                   as text, recorded as a transcript, exactly as the scenario tests
                   exercise it. */
                const first = await api.post(`/api/flows/runs/${run.id}/turn`, { text: '' });
                run = first.run;
                chat = [{ who: 'Interviewer', text: first.reply }];
                verified = true;
                paintRecording();
                scrim.remove();
                view = 'interview';
                renderShell();
                await renderView();
                return;
            }
            const { token, url } = tokenResp;
            const room = new Room();
            room.on(RoomEvent.TrackSubscribed, (track) => {
                if (track.kind === 'audio') {
                    track.attach(document.createElement('audio'));
                }
            });
            await room.connect(url, token);
            const micTrack = await createLocalAudioTrack();
            await room.localParticipant.publishTrack(micTrack);
            voiceCleanup = async () => {
                try {
                    micTrack.stop();
                }
                catch { /* the track may already be stopped */ }
                try {
                    await room.disconnect();
                }
                catch { /* the room may already be closed */ }
                voiceCleanup = null;
            };
            chat = [{ who: 'System', text: 'Voice session live. Recording with your consent.' }];
            verified = true;
            paintRecording();
            scrim.remove();
            view = 'interview';
            renderShell();
            await renderView();
        }
        catch (e) {
            toast(String(e.message));
        }
    });
    const cancel = h('button', { class: 'btn ml-2' }, 'Keep practicing privately');
    cancel.addEventListener('click', () => { scrim.remove(); verified = false; });
    modal.append(ok, cancel);
    scrim.append(modal);
    document.body.append(scrim);
    ck.focus();
    scrim.addEventListener('keydown', e => { if (e.key === 'Escape')
        scrim.remove(); });
}
/* Last line of defense: never leave the microphone publishing. */
window.addEventListener('beforeunload', () => { if (voiceCleanup)
    void voiceCleanup(); });
boot();
