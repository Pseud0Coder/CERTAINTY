/* Candidate app. The accelerator journey, gated server-side:
   onboarding -> research -> role-by-role resume -> CV -> LinkedIn -> interview. */
import { api, subscribe } from '../shared/api.js';
import { h, mark, stamp, toast, empty, clear, themeToggle, checkGlyph, lockGlyph, brandLockup, setWidthPct } from '../shared/dom.js';
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
let verified = false;
let voiceOn = false;
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
    }
    catch {
        location.href = '/login';
        return;
    }
    await refreshJourney();
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
function navItem(label, id, opts = {}) {
    const b = h('button', { class: 'nav-item', 'aria-current': view === id ? 'page' : 'false' });
    b.append(h('span', { class: 'lbl' }, label));
    if (opts.badge !== undefined && opts.badge > 0)
        b.append(h('span', { class: 'nav-badge' }, String(opts.badge)));
    if (opts.locked) {
        b.append(h('span', { class: 'nav-lock', title: opts.locked }, lockGlyph()));
        b.setAttribute('aria-disabled', 'true');
        b.addEventListener('click', () => toast(opts.locked));
        return b;
    }
    if (opts.module && !entitled(opts.module)) {
        b.setAttribute('aria-disabled', 'true');
        return b;
    }
    b.addEventListener('click', () => {
        view = id;
        run = null;
        chat = [];
        verified = false;
        activeRoleKey = null;
        paintRecording();
        renderShell();
        renderView();
        opts.onOpen?.();
    });
    return b;
}
function renderShell() {
    clear(root);
    const j = journey;
    const app = h('div', { class: 'app' });
    const rail = h('aside', { class: 'rail' }, h('div', { class: 'rail-head' }, brandLockup(), h('div', { class: 't-caption sub' }, 'Candidate')));
    const nav = h('nav', { class: 'nav' });
    const onboardingPending = !j || j.onboarding !== 'complete';
    nav.append(navItem(onboardingPending ? 'Get started' : 'Dashboard', 'dashboard', { module: 'journey' }));
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
    children.append(navItem('My Resume', 'resume', {
        module: 'resume_studio',
        locked: resumeLocked ? 'Complete your setup and the research step first' : undefined,
    }), navItem('LinkedIn', 'linkedin', {
        module: 'linkedin_studio',
        locked: j?.linkedin === 'locked' ? (j.unlockNotes['linkedin'] ?? 'Locked') : undefined,
    }), navItem('Portfolios', 'portfolios'));
    children.hidden = !roleExpanded;
    nav.append(group, children);
    nav.append(h('div', { class: 'nav-section' }, 'Interview'));
    nav.append(navItem('Sessions', 'interview', {
        module: 'practice',
        locked: j && j.interview === 'locked' ? (j.unlockNotes['interview'] ?? 'Locked') : undefined,
    }));
    nav.append(navItem('To-Do', 'todo', { badge: openTasks() }));
    rail.append(nav);
    const main = h('main', {}, h('header', { class: 'topbar' }, h('span', { class: 'role-chip' }, 'Candidate'), h('span', { class: 't-secondary topbar-name' }, me.user.displayName), h('span', { class: 'grow' }), h('span', { id: 'recSlot' }), themeToggle(), (() => {
        const b = h('button', { class: 'btn btn-sm' }, 'Log out');
        b.addEventListener('click', async () => { await api.post('/api/auth/logout'); location.href = '/login'; });
        return b;
    })()), h('div', { class: 'content', id: 'content' }));
    app.append(rail, main);
    root.append(app);
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
            renderPortfolios(content);
        else if (view === 'interview')
            await renderInterview(content);
    }
    catch (e) {
        content.append(empty('Something failed to load. Try again.'));
        console.error(e);
    }
}
/* ---------- onboarding ---------- */
async function renderOnboarding(content) {
    const self = lastSelf;
    content.append(h('h1', { class: 't-view' }, 'Get started'));
    content.append(h('p', { class: 't-secondary' }, `Welcome, ${self.name}. Share your target and your documents. The research step runs the moment you submit.`));
    const panel = h('div', { class: 'panel mt-6 w-720' });
    const company = h('input', { type: 'text', placeholder: 'e.g. Ledgerline', value: self.targetCompany ?? '' });
    const role = h('input', { type: 'text', placeholder: 'e.g. Senior Software Engineer', value: self.targetRole ?? '' });
    const jd = h('textarea', { rows: '6', placeholder: 'Paste the full job description' });
    const resume = h('textarea', { rows: '10', placeholder: 'Paste your current resume as plain text' });
    const liUrl = h('input', { type: 'text', placeholder: 'https://www.linkedin.com/in/...' });
    const liText = h('textarea', { rows: '5', placeholder: 'Optional: paste your LinkedIn profile text for a sharper check' });
    const pic = h('input', { type: 'file', accept: 'image/*', placeholder: 'Upload profile picture (optional)' });
    panel.append(h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Target company'), company), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Target role'), role), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Job description'), jd), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Your resume'), resume), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'LinkedIn profile'), liUrl, liText), h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Profile picture (optional)'), pic));
    const submit = h('button', { class: 'btn btn-primary' }, 'Submit and run research');
    submit.addEventListener('click', async () => {
        submit.setAttribute('aria-disabled', 'true');
        try {
            let profilePictureBase64 = '';
            const file = pic.files ? pic.files[0] : null;
            if (file) {
                profilePictureBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result);
                    reader.readAsDataURL(file);
                });
            }
            await api.post('/api/candidate/onboarding', {
                targetCompany: company.value, targetRole: role.value, jd: jd.value,
                resume: resume.value, linkedinUrl: liUrl.value, linkedinText: liText.value,
                profilePictureBase64,
            });
            toast('Research complete. Your report is ready.');
            await refreshJourney();
            view = 'dashboard';
            renderShell();
            await renderView();
        }
        catch (e) {
            toast(String(e.message));
            submit.setAttribute('aria-disabled', 'false');
        }
    });
    panel.append(h('p', { class: 't-caption my-3' }, 'Documents pass the quarantine pipeline first. Embedded instructions are stripped, never executed.'));
    panel.append(submit);
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
    const pdfBtn = h('button', { class: 'btn btn-primary btn-sm' }, 'Download PDF');
    pdfBtn.addEventListener('click', () => downloadBlob(buildCvPdf(cvBlocks(name, fields)), `${filenameBase}-CV.pdf`));
    const docxBtn = h('button', { class: 'btn btn-sm' }, 'Download DOCX');
    docxBtn.addEventListener('click', () => downloadBlob(buildCvDocx(cvBlocks(name, fields)), `${filenameBase}-CV.docx`));
    wrap.append(pdfBtn, docxBtn);
    return wrap;
}
/* ---------- dashboard ---------- */
function findingCard(f) {
    const cls = f.kind === 'good' ? 'good' : f.kind === 'improve' ? 'improve' : 'needs_work';
    return h('div', { class: `finding ${cls}` }, h('div', { class: 'finding-head' }, h('span', { class: `chip-pastel ${f.kind === 'good' ? 'green' : f.kind === 'improve' ? 'blue' : 'red'}` }, f.kind === 'good' ? 'Good' : f.kind === 'improve' ? 'Improve' : 'Needs work'), h('span', { class: 't-section' }, f.title)), h('p', { class: 't-body' }, f.detail));
}
async function renderDashboard(content) {
    const self = lastSelf;
    const j = journey;
    content.append(h('h1', { class: 't-view' }, 'Dashboard'));
    content.append(h('p', { class: 't-secondary' }, `Target: ${self.targetRole}${self.targetCompany ? ` at ${self.targetCompany}` : ''}.`));
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
    content.append(strip);
    const grid = h('div', { class: 'grid2 mt-6' });
    /* Research report. */
    const report = h('div', { class: 'panel' });
    report.append(h('h2', { class: 't-section' }, 'Research report'));
    if (!j.findings.length) {
        report.append(empty('The research step has not run yet.'));
    }
    else {
        const counts = { good: 0, improve: 0, needs_work: 0 };
        for (const f of j.findings)
            counts[f.kind]++;
        report.append(h('p', { class: 't-caption mb-3' }, `${counts.good} good · ${counts.improve} to improve · ${counts.needs_work} needs work`));
        for (const f of j.findings)
            report.append(findingCard(f));
    }
    grid.append(report);
    /* Deliverables and sessions. */
    const right = h('div', {});
    const cv = self.artifacts.filter(a => a.kind === 'cv').at(-1);
    const del = h('div', { class: 'panel mb-6' });
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
        sess.append(h('div', { class: 'srow' }, h('span', { class: 't-secondary' }, `${s.mode === 'verified' ? 'Verified' : 'Practice'} · ${s.date}`), s.star ? stamp(`STAR ${s.star.S}/${s.star.T}/${s.star.A}/${s.star.R}`) : h('span', { class: 't-caption' }, s.status)));
    }
    right.append(sess);
    grid.append(right);
    content.append(grid);
}
/* ---------- resume studio: role list and per-role session ---------- */
async function renderResume(content) {
    const j = journey;
    content.append(h('h1', { class: 't-view' }, 'My Resume'));
    content.append(h('p', { class: 't-secondary' }, 'One role per session, in depth. Each role gets its own interviewer.'));
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
                const copy = h('button', { class: 'btn mt-3' }, 'Copy bullets');
                copy.addEventListener('click', async () => {
                    try {
                        await navigator.clipboard.writeText(handoff.content);
                        toast('Bullets copied');
                    }
                    catch {
                        toast('Select and copy manually');
                    }
                });
                panel.append(copy);
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
/* ---------- linkedin ---------- */
async function renderLinkedin(content) {
    const j = journey;
    if (j.linkedin === 'locked') {
        content.append(h('h1', { class: 't-view' }, 'LinkedIn'));
        content.append(empty(j.unlockNotes['linkedin'] ?? 'Locked until your resume is complete.'));
        return;
    }
    await renderStudio(content, 'linkedin_studio', 'LinkedIn', 'Your resume is the source of truth. Titles and dates always match.', 'Generate a section');
}
/* ---------- generic studio (linkedin) ---------- */
async function renderStudio(content, flowId, title, sub, actionLabel) {
    content.append(h('h1', { class: 't-view' }, title));
    content.append(h('p', { class: 't-secondary' }, sub));
    const panel = h('div', { class: 'panel mt-6' });
    if (!run) {
        panel.append(empty('A fresh session, one section at a time.', { label: actionLabel, fn: async () => {
                try {
                    const resp = await api.post(`/api/candidate/flows/${flowId}/start`);
                    run = resp.run;
                    chat = [];
                    const first = await api.post(`/api/flows/runs/${run.id}/turn`, { text: 'start' });
                    chat.push({ who: 'Interviewer', text: first.reply });
                    run = first.run;
                    await renderView();
                }
                catch (e) {
                    toast(String(e.message));
                }
            } }));
        content.append(panel);
        return;
    }
    const log = h('div', { class: 'chatlog' });
    for (const m of chat) {
        log.append(h('div', { class: 'turn plain' }, h('div', {}, h('span', { class: 'who' }, m.who), h('span', { class: 't-body' }, m.text))));
    }
    panel.append(log);
    if (run.status === 'complete') {
        panel.append(h('p', { class: 't-caption mt-4' }, 'All sections delivered. Copy them into your profile, then move to the interview.'));
    }
    else {
        const input = h('input', { type: 'text', placeholder: 'Ask for a section, e.g. headline', 'aria-label': 'Your message' });
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
}
/* ---------- portfolios ---------- */
function renderPortfolios(content) {
    content.append(h('h1', { class: 't-view' }, 'Portfolios'));
    content.append(empty('Coming soon. Your portfolio work will live here.'));
}
/* ---------- to-do ---------- */
async function renderTodo(content) {
    const self = lastSelf;
    content.append(h('h1', { class: 't-view' }, 'To-Do'));
    const head = h('div', { class: 'row gap-3 mt-2 wrap' });
    head.append(h('p', { class: 't-secondary' }, 'Reviewed and approved by your recruiter. Work through them one by one.'));
    if (self.tasks.length > 0)
        head.append(h('span', { class: 'todo-badge' }, `${self.tasks.length} open`));
    content.append(head);
    const list = h('div', { class: 'my-6 w-640' });
    if (!self.tasks.length)
        list.append(empty('Nothing on your list right now. Your CV and your interview answers line up.'));
    for (const t of self.tasks) {
        const card = h('div', { class: 'todo-card' });
        const header = h('header', { class: 'row gap-2 mb-2 wrap' }, mark(t.type === 'warn' ? 'conflict' : 'confirmed'), h('h3', { class: 't-section' }, t.title));
        if (t.source === 'recruiter')
            header.append(stamp('From your recruiter'));
        card.append(header, h('p', { class: 't-body' }, t.body));
        const done = h('button', { class: 'btn btn-sm' }, 'Mark done');
        done.addEventListener('click', async () => {
            await api.post(`/api/candidate/tasks/${t.id}/done`);
            toast('Done');
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
    if (j.interview === 'locked') {
        content.append(h('h1', { class: 't-view' }, 'Interview'));
        content.append(empty(j.unlockNotes['interview'] ?? 'Locked until your CV and LinkedIn are complete.'));
        return;
    }
    content.append(h('h1', { class: 't-view' }, 'Interview'));
    content.append(h('p', { class: 't-secondary' }, 'Practice is private. Verified sessions are shared with your recruiter.'));
    const pane = h('div', { class: 'splitpane mt-6' });
    const left = h('div', { class: 'pane' });
    const seg = h('div', { class: 'modeseg', role: 'group', 'aria-label': 'Session mode' });
    const pB = h('button', { 'aria-pressed': verified ? 'false' : 'true' }, 'Practice · private');
    const vB = h('button', { 'aria-pressed': verified ? 'true' : 'false' }, 'Verified · shared');
    seg.append(pB, vB);
    pB.addEventListener('click', () => { verified = false; run = null; chat = []; paintRecording(); renderView(); });
    vB.addEventListener('click', () => { verified = true; run = null; chat = []; renderView(); });
    left.append(h('div', { class: 'row wrap gap-2' }, seg));
    left.append(h('p', { class: 't-caption my-3' }, verified
        ? 'Verified mode. Recording, with your consent. Shared with your recruiter, gaps included.'
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
            again.addEventListener('click', () => { run = null; chat = []; verified = false; paintRecording(); renderView(); });
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
                        toast('Consent withdrawn. Recording stopped and artifacts flagged.');
                        verified = false;
                        paintRecording();
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
function voiceState(hasRun) {
    if (!voiceOn)
        return 'muted';
    if (!hasRun || run?.status === 'complete' || run?.status === 'failed')
        return 'idle';
    return awaitingReply ? 'thinking' : 'waiting';
}
const VOICE_LABEL = {
    idle: 'Idle', waiting: 'Your turn', thinking: 'Thinking', muted: 'Muted, text only',
};
/* The mic glyph used by both the orb and the mic button: one path drawn
   at whatever size the caller asks for. */
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
    const state = voiceState(hasRun);
    const orb = h('div', { class: `orb vstate-${state}` }, micGlyph(38));
    const vlabel = h('div', { class: 'vlabel' }, VOICE_LABEL[state]);
    const mic = h('button', { class: 'mic', 'aria-pressed': voiceOn ? 'true' : 'false',
        'aria-label': voiceOn ? 'Turn voice off' : 'Turn voice on' }, micGlyph(22));
    mic.addEventListener('click', () => {
        voiceOn = !voiceOn;
        toast(voiceOn ? 'Voice requested. Speech runs when the provider is configured; text works now.' : 'Voice off. Text mode.');
        renderView();
    });
    return h('div', { class: 'pane voicecol' }, orb, vlabel, mic, starArea(hasRun));
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
            const { token, url } = await api.post('/api/candidate/livekit/token', {});
            const room = new Room();
            room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
                if (track.kind === 'audio') {
                    track.attach(document.createElement('audio'));
                }
            });
            await room.connect(url, token);
            const micTrack = await createLocalAudioTrack();
            await room.localParticipant.publishTrack(micTrack);
            chat = [{ who: 'System', text: 'LiveKit Voice Connection Established.' }];
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
boot();
