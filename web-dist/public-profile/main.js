/* Public candidate profile: the shareable "brief overview" a recruiter
   sends to the end customer. Unauthenticated by design, the id in the
   URL is the capability token (see Store.publicProfilePage server side).
   No session, no cookies sent, no CSRF: this is a plain read plus a
   client-side document download, same as the rest of the CV pipeline. */
import { h, checkGlyph, clear } from '../shared/dom.js';
import { cvBlocks } from '../shared/cv-template.js';
import { buildCvPdf } from '../shared/pdf.js';
import { buildCvDocx } from '../shared/docx.js';
const root = document.getElementById('root');
function initials(name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}
function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}
function renderNotFound() {
    root.append(h('div', { class: 'profile-notfound' }, h('h1', {}, 'This link is not available'), h('p', {}, 'The profile may not be ready yet, or the link has expired. Ask the recruiter for a fresh one.')));
}
function renderProfile(p, cv) {
    const hero = h('div', { class: 'profile-hero' }, h('div', { class: 'profile-avatar' }, initials(p.name)), h('div', { class: 'profile-id' }, h('h1', { class: 'profile-name' }, p.name), h('p', { class: 'profile-headline' }, p.headline), h('p', { class: 'profile-loc' }, p.location)));
    root.append(hero);
    if (p.verified) {
        const badge = h('span', { class: 'verified-badge' }, checkGlyph(12), h('span', {}, 'Verified via structured interview'));
        root.append(badge);
    }
    if (p.companies.length) {
        const sec = h('div', { class: 'profile-section' }, h('h2', {}, 'Worked with'));
        const wrap = h('div', { class: 'chip-wrap' });
        for (const c of p.companies)
            wrap.append(h('span', { class: 'chip' }, c));
        sec.append(wrap);
        root.append(sec);
    }
    if (p.highlights.length) {
        const sec = h('div', { class: 'profile-section' }, h('h2', {}, 'Highlights'));
        const list = h('div', { class: 'highlight-list' });
        for (const item of p.highlights)
            list.append(h('p', { class: 'highlight-item' }, item));
        sec.append(list);
        root.append(sec);
    }
    if (p.skills.length) {
        const sec = h('div', { class: 'profile-section' }, h('h2', {}, 'Skills'));
        for (const g of p.skills) {
            sec.append(h('p', { class: 'skill-group' }, h('b', {}, `${g.group}: `), document.createTextNode(g.items.join(', '))));
        }
        root.append(sec);
    }
    if (p.education.length) {
        const sec = h('div', { class: 'profile-section' }, h('h2', {}, 'Education'));
        const list = h('div', { class: 'edu-list' });
        for (const e of p.education)
            list.append(h('p', {}, e));
        sec.append(list);
        root.append(sec);
    }
    if (cv) {
        const fields = cv;
        const filenameBase = p.name.replace(/\s+/g, '-');
        const dl = h('div', { class: 'profile-dl' }, h('p', {}, 'The full CV, including contact details, is available as a download.'));
        const actions = h('div', { class: 'profile-dl-actions' });
        const pdfBtn = h('button', { class: 'mbtn mbtn-primary' }, 'Download PDF');
        pdfBtn.addEventListener('click', () => downloadBlob(buildCvPdf(cvBlocks(p.name, fields)), `${filenameBase}-CV.pdf`));
        const docxBtn = h('button', { class: 'mbtn mbtn-line' }, 'Download DOCX');
        docxBtn.addEventListener('click', () => downloadBlob(buildCvDocx(cvBlocks(p.name, fields)), `${filenameBase}-CV.docx`));
        actions.append(pdfBtn, docxBtn);
        dl.append(actions);
        root.append(dl);
    }
}
async function boot() {
    const id = location.pathname.split('/').filter(Boolean).at(-1) ?? '';
    clear(root);
    try {
        const res = await fetch(`/api/public/profile/${encodeURIComponent(id)}`);
        if (!res.ok) {
            renderNotFound();
            return;
        }
        const data = await res.json();
        renderProfile(data.profile, data.cv);
    }
    catch {
        renderNotFound();
    }
}
boot();
