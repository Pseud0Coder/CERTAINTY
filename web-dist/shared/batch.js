/* Batch screening view (ADR-0030): one JD, many CVs, a ranked leaderboard the
   recruiter triages. The rubric is read once, so every CV is judged on the
   same axes and the scores are comparable. */
import { api } from './api.js';
import { h, stamp, toast, empty, clear, fileToBase64, setWidthPct } from './dom.js';
import { ERRORS, REC_MARK, renderResult } from './screening.js';
const MAX_FILES = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
export async function renderBatch(root) {
    const stage = h('div', { class: 'sc-batch' });
    root.append(stage);
    await showList(stage);
}
/* ---------- list and new batch ---------- */
async function showList(stage) {
    clear(stage);
    stage.append(newBatchPanel(stage));
    const box = h('section', { class: 'panel mt-6', 'aria-label': 'Recent batches' }, h('h2', { class: 't-section' }, 'Recent batches'));
    stage.append(box);
    let items = [];
    try {
        items = (await api.get('/api/batches')).items;
    }
    catch { /* leave empty */ }
    if (!items.length) {
        box.append(empty('No batches yet. Start one above.'));
        return;
    }
    const list = h('ul', { class: 'sc-history' });
    for (const b of items) {
        const btn = h('button', { class: 'sc-hist-item' }, h('span', { class: 'sc-hist-score' }, String(b.count)), h('span', { class: 'sc-hist-main' }, h('span', { class: 't-body' }, b.label), h('span', { class: 't-caption' }, `${b.count === 1 ? '1 CV' : `${b.count} CVs`}${b.avg !== null ? ` · average ${b.avg.toFixed(1)}` : ''} · ${b.shortlisted} shortlisted · ${b.createdAt.slice(0, 10)}`)));
        btn.addEventListener('click', () => void showBatch(stage, b.id));
        list.append(h('li', {}, btn));
    }
    box.append(list);
}
function newBatchPanel(stage) {
    let jdFile = null;
    let files = [];
    const jdName = h('span', { class: 't-caption' }, 'No file chosen');
    const jdInput = h('input', { type: 'file', accept: '.pdf,.docx', class: 'sr-only', id: 'bt-jd-file' });
    jdInput.addEventListener('change', () => { jdFile = jdInput.files?.[0] ?? null; jdName.textContent = jdFile ? jdFile.name : 'No file chosen'; });
    const jdText = h('textarea', { rows: '8', id: 'bt-jd-text', placeholder: 'Paste the job description here', 'aria-label': 'Job description text' });
    const label = h('input', { type: 'text', id: 'bt-label', placeholder: 'Optional: a name for this batch', 'aria-label': 'Batch name' });
    const cvInput = h('input', { type: 'file', accept: '.pdf,.docx', multiple: 'true', class: 'sr-only', id: 'bt-cv-files' });
    const fileList = h('ul', { class: 'sc-files', 'aria-label': 'Chosen CV files' });
    const count = h('p', { class: 't-caption mt-2' }, 'No CVs chosen yet.');
    const paintFiles = () => {
        clear(fileList);
        for (const f of files.slice(0, 8))
            fileList.append(h('li', {}, f.name));
        if (files.length > 8)
            fileList.append(h('li', { class: 't-caption' }, `and ${files.length - 8} more`));
        count.textContent = files.length ? `${files.length} CV${files.length === 1 ? '' : 's'} chosen.` : 'No CVs chosen yet.';
    };
    const add = (picked) => {
        const ok = picked.filter(f => /\.(pdf|docx)$/i.test(f.name) && f.size <= MAX_FILE_BYTES);
        if (ok.length < picked.length)
            toast('Some files were skipped: only PDF or Word files up to 5 MB.');
        files = [...files, ...ok].slice(0, MAX_FILES);
        if (files.length === MAX_FILES)
            toast(`A batch holds up to ${MAX_FILES} CVs.`);
        paintFiles();
    };
    cvInput.addEventListener('change', () => { add(Array.from(cvInput.files ?? [])); cvInput.value = ''; });
    const drop = h('label', { class: 'sc-drop', for: 'bt-cv-files' }, 'Drop CV files here, or choose them', cvInput);
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); add(Array.from(e.dataTransfer?.files ?? [])); });
    const start = h('button', { class: 'btn btn-primary', id: 'bt-start' }, 'Start batch');
    const status = h('span', { class: 't-caption', role: 'status' });
    start.addEventListener('click', async () => {
        if (!jdFile && !jdText.value.trim()) {
            toast(ERRORS['jd_required']);
            return;
        }
        if (!files.length) {
            toast('Choose at least one CV file.');
            return;
        }
        start.setAttribute('disabled', 'true');
        try {
            status.textContent = 'Reading the job description';
            const created = await api.post('/api/batches', {
                jd: jdFile ? { filename: jdFile.name, dataBase64: await fileToBase64(jdFile) } : { text: jdText.value },
                label: label.value,
            });
            let sent = 0, refused = 0;
            for (const f of files) {
                status.textContent = `Uploading ${sent + refused + 1} of ${files.length}: ${f.name}`;
                try {
                    await api.post(`/api/batches/${created.batch.id}/cvs`, { cv: { filename: f.name, dataBase64: await fileToBase64(f) } });
                    sent++;
                }
                catch (e) {
                    refused++;
                    const code = String(e.message);
                    toast(`${f.name}: ${ERRORS[code] ?? 'could not be read'}`);
                    if (code === 'daily_limit_reached' || code === 'instance_limit_reached')
                        break;
                }
            }
            if (!sent) {
                toast('None of the CVs could be added.');
                start.removeAttribute('disabled');
                status.textContent = '';
                return;
            }
            await showBatch(stage, created.batch.id);
        }
        catch (e) {
            toast(ERRORS[String(e.message)] ?? 'The batch could not be started. Try again.');
            start.removeAttribute('disabled');
            status.textContent = '';
        }
    });
    return h('section', { class: 'panel', 'aria-label': 'New batch' }, h('h2', { class: 't-section' }, 'New batch'), h('p', { class: 't-secondary' }, 'One job description, many CVs. The JD is read once, so every CV is scored on the same axes and the scores can be ranked.'), h('div', { class: 'sc-inputs mt-4' }, h('div', { class: 'sc-part' }, h('h3', { class: 't-body' }, 'Job description'), h('div', { class: 'row gap-2 wrap mt-2' }, h('label', { class: 'btn file-pick' }, jdInput, 'Upload PDF or Word'), jdName), jdText), h('div', { class: 'sc-part' }, h('h3', { class: 't-body' }, 'CVs'), drop, count, fileList)), h('div', { class: 'sc-extras mt-4' }, label, h('span', {})), h('div', { class: 'row gap-3 mt-4' }, start, status));
}
/* ---------- one batch: progress, leaderboard, drill-in ---------- */
async function showBatch(stage, id) {
    clear(stage);
    const header = h('div', { class: 'sc-batch-head' });
    const progress = h('div', {});
    const board = h('div', { class: 'mt-4' });
    const detail = h('div', { class: 'mt-6', id: 'bt-detail' });
    const back = h('button', { class: 'btn btn-sm btn-ghost' }, 'All batches');
    back.addEventListener('click', () => { stopped = true; void showList(stage); });
    stage.append(h('div', { class: 'row gap-3' }, back), header, progress, board, detail);
    let stopped = false;
    let openId = null;
    const open = async (rowId) => {
        openId = rowId;
        try {
            const res = await api.get(`/api/batches/${id}/items/${rowId}`);
            clear(detail);
            detail.append(renderResult(res.screening, 'recruiter'));
            detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        catch {
            toast('Could not open that CV.');
        }
    };
    const paint = (v) => {
        clear(header);
        header.append(h('h2', { class: 'sc-batch-title' }, v.batch.label), h('p', { class: 't-secondary' }, `${v.batch.jobTitle ?? 'Job description'} · ${v.leaderboard.length} screened`), h('p', { class: 't-caption mt-2' }, `Judged on: ${v.axes.map(a => `${a.title}${a.priority === 'must' ? '' : ' (nice)'}`).join(', ')}`), tallyChips(v.tallies));
        clear(progress);
        const waiting = v.queue.filter(q => q.status === 'queued' || q.status === 'running');
        const failed = v.queue.filter(q => q.status === 'failed');
        if (waiting.length) {
            const total = v.leaderboard.length + waiting.length + failed.length;
            progress.append(h('section', { class: 'panel mt-4 sc-progress', 'aria-label': 'Batch progress' }, h('h2', { class: 't-section' }, `Screening ${v.leaderboard.length} of ${total}`), h('div', { class: 'sc-bar' }, setWidthPct(h('div', { class: 'sc-bar-fill' }), (v.leaderboard.length / total) * 100)), h('ul', { class: 'sc-files mt-2' }, ...waiting.slice(0, 6).map(q => h('li', {}, `${q.status === 'running' ? 'Reading' : 'Waiting'}: ${q.name}`)))));
        }
        if (failed.length) {
            progress.append(h('section', { class: 'panel mt-4', 'aria-label': 'CVs that failed' }, h('h2', { class: 't-section' }, `${failed.length} CV${failed.length === 1 ? '' : 's'} could not be screened`), h('ul', { class: 'sc-files' }, ...failed.map(q => h('li', {}, `${q.name}: ${ERRORS[q.error ?? ''] ?? 'the screening did not complete'}`)))));
        }
        clear(board);
        board.append(leaderboardTable(v.leaderboard, rowId => void open(rowId), openId));
        const del = h('button', { class: 'btn btn-sm btn-ghost mt-4' }, 'Delete this batch');
        del.addEventListener('click', async () => {
            if (!confirm('Delete this batch and every CV in it?'))
                return;
            await api.del(`/api/batches/${id}`);
            stopped = true;
            toast('Batch deleted');
            void showList(stage);
        });
        board.append(del);
    };
    /* Poll while anything is still queued or running. */
    for (let i = 0; i < 1800 && !stopped; i++) {
        let v;
        try {
            v = await api.get(`/api/batches/${id}`);
        }
        catch {
            toast('Could not load that batch.');
            void showList(stage);
            return;
        }
        if (stopped)
            return;
        paint(v);
        if (!v.queue.some(q => q.status === 'queued' || q.status === 'running'))
            return;
        await new Promise(r => setTimeout(r, 1500));
    }
}
function tallyChips(t) {
    const chip = (label, n) => h('span', { class: 'chip sc-tally' }, `${label} ${n}`);
    return h('div', { class: 'chip-row sc-tallies mt-2', role: 'status', 'aria-label': 'Triage tallies' }, chip('Shortlisted', t.shortlist), chip('Maybe', t.maybe), chip('Pass', t.pass), chip('Undecided', t.undecided));
}
function leaderboardTable(rows, onOpen, openId) {
    if (!rows.length)
        return empty('Results appear here as each CV is screened.');
    const table = h('table', { class: 'sc-table', 'aria-label': 'Ranked CVs' });
    table.append(h('thead', {}, h('tr', {}, ...['#', 'Candidate', 'Score', 'Result', 'Percentile', 'Flags', 'Years', 'Skills', 'Decision'].map(c => h('th', { scope: 'col' }, c)))));
    const tbody = h('tbody', {});
    for (const r of rows) {
        const flags = [];
        if (r.capped)
            flags.push('Capped');
        if (r.mustMissing)
            flags.push(`${r.mustMissing} must-have${r.mustMissing === 1 ? '' : 's'} missing`);
        const tr = h('tr', { 'data-id': r.id, 'data-decision': r.decision ?? '', tabindex: '0', 'aria-selected': r.id === openId ? 'true' : 'false' }, h('td', {}, String(r.rank)), h('td', {}, h('span', { class: 'sc-cand' }, r.name), r.file ? h('span', { class: 't-caption' }, r.file) : h('span', {})), h('td', { class: 'sc-num' }, r.overall.toFixed(1)), h('td', {}, stamp(r.recommendation, REC_MARK[r.recommendation] ?? 'claimed')), h('td', {}, r.percentile === null ? 'n/a' : `${r.percentile}`), h('td', {}, flags.length ? flags.join(', ') : 'None'), h('td', {}, r.years === null ? 'n/a' : `${r.years}${r.yearsStated ? ' stated' : ''}`), h('td', {}, r.skills.required ? `${r.skills.found}/${r.skills.required}` : 'n/a'), h('td', { class: 'sc-decision' }, r.decision ? r.decision[0].toUpperCase() + r.decision.slice(1) : 'Undecided'));
        tr.addEventListener('click', () => onOpen(r.id));
        tr.addEventListener('keydown', e => { if (e.key === 'Enter')
            onOpen(r.id); });
        tbody.append(tr);
    }
    table.append(tbody);
    return h('div', { class: 'sc-table-wrap' }, table);
}
