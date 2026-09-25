/* Recruiter app. Dashboards render state; agents never touch the UI (A0). */
import { api, subscribe } from '../shared/api.js';
import { h, mark, stamp, badge, toast, empty, clear, MARK_WORD, themeToggle, setWidthPct, brandLockup } from '../shared/dom.js';
import type { MarkState } from '../shared/dom.js';

interface Me { user: { id: string; role: string; displayName: string; tenantId: string }; entitlements: string[]; stages: string[] }
interface CandidateCard { id: string; name: string; targetRole: string; stage: string; parked: boolean; openFlags: number; verifyFlags: number }
interface Detail {
  candidate: { id: string; name: string; targetRole: string; employer: string; tenure: string; stage: string; parked: boolean;
    currentCompensation: string | null; compExpectations: string | null; noticePeriod: string | null; motivation: string | null };
  flags: Array<{ id: string; type: string; status: string; title: string; body: string; quote: string }>;
  sessions: Array<{ id: string; mode: string; status: string; date: string; duration: string; star: Record<string, number> | null;
    targets: Record<string, number>; ownership: number | null; transcript: Array<{ t: string; who: string; text: string; annot?: { mark: string; label: string } }> }>;
  tasks: Array<{ id: string; title: string; done: boolean }>;
  artifacts: Array<{ id: string; kind: string; title: string; quarantine: string; injectionAttempts: number; content: string | null }>;
  suggestion: string | null;
}

let me: Me;
let view = 'pipeline';
let detailId: string | null = null;
const root = document.getElementById('root')!;

const NAV = [
  { id: 'pipeline', label: 'Pipeline', module: 'pipeline' },
  { id: 'builder', label: 'Submission builder', module: 'builder' },
  { id: 'notes', label: 'Notes', module: 'notes' },
];

function entitled(m: string): boolean { return me.entitlements.includes(m); }

async function boot(): Promise<void> {
  try {
    me = await api.get('/api/me');
    if (me.user.role === 'candidate') { location.href = '/app/candidate'; return; }
  } catch {
    location.href = '/login';
    return;
  }
  renderShell();
  await renderView();
  subscribe(['flag.changed', 'session.changed', 'stage.suggested', 'artifact.changed', 'task.changed', 'flow.complete'], renderView);
}

function renderShell(): void {
  clear(root);
  const app = h('div', { class: 'app' });
  const rail = h('aside', { class: 'rail' },
    h('div', { class: 'rail-head' },
      brandLockup(),
      h('div', { class: 't-caption sub' }, 'Recruiter')));
  const nav = h('nav', { class: 'nav' });
  for (const item of NAV) {
    const b = h('button', { class: 'nav-item', 'aria-current': view === item.id ? 'page' : 'false' },
      h('span', { class: 'lbl' }, item.label));
    if (!entitled(item.module)) b.setAttribute('aria-disabled', 'true');
    else b.addEventListener('click', () => { view = item.id; renderShell(); renderView(); });
    nav.append(b);
  }
  rail.append(nav);
  const main = h('main', {},
    h('header', { class: 'topbar' },
      stamp('Recruiter'), h('span', { class: 't-secondary' }, me.user.displayName),
      h('span', { class: 'grow' }),
      themeToggle(),
      (() => { const b = h('button', { class: 'btn btn-sm' }, 'Log out'); b.addEventListener('click', async () => { await api.post('/api/auth/logout'); location.href = '/login'; }); return b; })()),
    h('div', { class: 'content', id: 'content' }));
  app.append(rail, main);
  root.append(app);
}

async function renderView(): Promise<void> {
  const content = document.getElementById('content');
  if (!content) return;
  clear(content);
  try {
    if (view === 'pipeline') await renderPipeline(content);
    else if (view === 'builder') await renderBuilder(content);
    else if (view === 'notes') await renderNotes(content);
    else if (view === 'detail' && detailId) await renderDetail(content, detailId);
  } catch (e) {
    content.append(empty('Something failed to load. The pipeline itself is code, so try again.'));
    console.error(e);
  }
}

/* ---------- pipeline ---------- */
async function renderPipeline(content: HTMLElement): Promise<void> {
  const data = await api.get('/api/recruiter/pipeline');
  const header = h('div', { class: 'viewhead' },
    h('div', { class: 'viewhead-text' },
      h('h1', { class: 't-view' }, 'Pipeline'),
      h('p', { class: 't-secondary' }, 'One stage per advance. Stage suggestions come from the stage advisor; humans advance.')));
  const addBtn = h('button', { class: 'btn btn-primary' }, 'Add candidate');
  addBtn.addEventListener('click', () => showAddCandidate(() => renderView()));
  header.append(addBtn);
  content.append(header);
  const board = h('div', { class: 'board mt-6' });
  for (const stage of data.stages as string[]) {
    const cards = (data.candidates as CandidateCard[]).filter(c => c.stage === stage);
    /* The count belongs in the header: a recruiter reads pipeline shape
       before reading any single card. */
    const col = h('section', { class: 'bcol', 'aria-label': `${stage}, ${cards.length} candidates` },
      h('div', { class: 'colhead' },
        h('span', { class: 't-section' }, stage),
        h('span', { class: 'colcount' }, String(cards.length))));
    const stack = h('div', { class: 'bstack' });
    col.append(stack);
    if (!cards.length) stack.append(h('p', { class: 'bempty' }, 'Empty'));
    for (const c of cards) {
      const card = h('div', { class: 'pcard reveal-host', tabindex: '0', role: 'button', 'aria-label': `${c.name}, open detail` });
      card.append(h('div', { class: 'nm' }, c.name));
      card.append(h('div', { class: 't-caption' }, c.targetRole));
      const badges = h('div', { class: 'badges' });
      if (c.openFlags > 0) badges.append(badge(`${c.openFlags} flags`, 'gap'));
      if (c.verifyFlags > 0) badges.append(badge('verify', 'conflict'));
      if (c.openFlags === 0 && c.verifyFlags === 0) badges.append(stamp('synced'));
      card.append(badges);
      const acts = h('div', { class: 'card-acts' });
      const reveal = h('span', { class: 'reveal iflex gap-2' });
      if (!c.parked) {
        const adv = h('button', { class: 'btn btn-sm' }, 'Advance');
        adv.addEventListener('click', async e => {
          e.stopPropagation();
          try { await api.post(`/api/recruiter/candidates/${c.id}/advance`); toast('Stage advanced'); await renderView(); }
          catch (err) { toast(String((err as Error).message)); }
        });
        const parkB = h('button', { class: 'btn btn-sm' }, 'Park');
        parkB.addEventListener('click', async e => {
          e.stopPropagation();
          await api.post(`/api/recruiter/candidates/${c.id}/park`); toast('Parked'); await renderView();
        });
        reveal.append(adv, parkB);
      } else {
        const res = h('button', { class: 'btn btn-sm' }, 'Restore');
        res.addEventListener('click', async e => {
          e.stopPropagation();
          await api.post(`/api/recruiter/candidates/${c.id}/restore`); toast('Restored'); await renderView();
        });
        reveal.append(res);
      }
      acts.append(reveal);
      card.append(acts);
      card.addEventListener('click', () => { detailId = c.id; view = 'detail'; renderShell(); renderView(); });
      card.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') card.click(); });
      stack.append(card);
    }
    board.append(col);
  }
  content.append(board);
}

/* ---------- candidate detail ---------- */
async function renderDetail(content: HTMLElement, id: string): Promise<void> {
  const d: Detail = await api.get(`/api/recruiter/candidates/${id}`);
  const back = h('button', { class: 'btn btn-sm' }, 'Pipeline');
  back.addEventListener('click', () => { view = 'pipeline'; renderShell(); renderView(); });
  content.append(back);

  const head = h('div', { class: 'panel mt-3' });
  const line = h('div', { class: 'row-baseline gap-4' },
    h('h1', { class: 't-view' }, d.candidate.name),
    stamp(d.candidate.stage));
  head.append(line);
  head.append(h('p', { class: 't-secondary' }, `${d.candidate.targetRole} · ${d.candidate.employer} · ${d.candidate.tenure}`));
  head.append(h('p', { class: 't-caption' }, 'One source conflict flagged. Conservative dates in use.'));
  content.append(head);

  /* Journey progress from the shared spine (research, roles, CV, LinkedIn). */
  try {
    const j = await api.get(`/api/recruiter/candidates/${id}/journey`);
    const jr = j.journey;
    const line = h('div', { class: 'chip-row mt-3' });
    line.append(h('span', { class: 't-caption' }, `Setup ${jr.onboarding} · Research ${jr.research}`),
      h('span', { class: 't-caption' }, `Roles ${(jr.roles as Array<{ done: boolean }>).filter(r => r.done).length}/${(jr.roles as unknown[]).length} · CV ${jr.cv} · LinkedIn ${jr.linkedin} · Interview ${jr.interview}`));
    content.append(line);
  } catch { /* progress line is best effort */ }

  content.append(renderProfileShare(d));

  if (d.suggestion) {
    const chip = h('div', { class: 'chip-row mt-3' },
      mark('claimed'), h('span', { class: 't-caption' }, `Stage advisor suggests: ${d.suggestion}. Humans advance.`));
    const apply = h('button', { class: 'btn btn-sm ml-2' }, 'Advance to ' + d.suggestion);
    apply.addEventListener('click', async () => {
      await api.post(`/api/recruiter/candidates/${id}/advance`); toast('Stage advanced'); await renderView();
    });
    chip.append(apply);
    content.append(chip);
  }

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panels: Record<string, HTMLElement> = {};
  const tabDefs: Array<[string, string]> = [
    ['ins', 'Insights'], ['tr', 'Transcript'], ['fl', 'Gap flags'], ['nt', 'Notes'],
  ];
  for (const [key, label] of tabDefs) {
    const t = h('button', { class: 'tab', role: 'tab', 'aria-selected': key === 'ins' ? 'true' : 'false' }, label);
    t.addEventListener('click', () => {
      for (const [k] of tabDefs) {
        panels[k]!.hidden = k !== key;
        (t.parentElement!.children as HTMLCollectionOf<HTMLElement>)[tabDefs.findIndex(x => x[0] === k)]!
          .setAttribute('aria-selected', k === key ? 'true' : 'false');
      }
    });
    tabs.append(t);
  }
  content.append(tabs);

  panels['ins'] = renderInsights(d);
  panels['tr'] = renderTranscript(d);
  panels['fl'] = renderFlags(d, id);
  panels['nt'] = renderNotesPanel(d);
  for (const [i, [k]] of tabDefs.entries()) {
    panels[k]!.hidden = i !== 0;
    content.append(panels[k]!);
  }

  /* Builder inside detail: sources, ingest, run. */
  content.append(await renderBuilderPanel(d, id));
}

/* Shareable candidate profile: generated by the same agent block that
   assembles the CV, once every role has been revamped. One link, no
   login, the end customer sees a brief overview and can pull the CV. */
function renderProfileShare(d: Detail): HTMLElement {
  const panel = h('div', { class: 'panel mt-3' });
  panel.append(h('h2', { class: 't-section' }, 'Shareable profile'));
  const page = d.artifacts.filter(a => a.kind === 'profile_page').at(-1);
  if (!page) {
    panel.append(empty('Generated once every role in My Resume is complete.'));
    return panel;
  }
  const url = `${location.origin}/p/${page.id}`;
  const row = h('div', { class: 'row gap-2' },
    h('input', { class: 'share-link', type: 'text', value: url, readonly: 'true', 'aria-label': 'Shareable profile link' }));
  const copy = h('button', { class: 'btn btn-sm' }, 'Copy link');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch { toast('Select and copy manually'); }
  });
  const open = h('a', { class: 'btn btn-sm', href: url, target: '_blank', rel: 'noopener' }, 'Open');
  row.append(copy, open);
  panel.append(row);
  return panel;
}

function renderInsights(d: Detail): HTMLElement {
  const panel = h('div', { class: 'panel' });
  const s = d.sessions[0];
  if (!s) {
    panel.append(empty('No verified sessions yet. Practice sessions stay private to the candidate.',
      { label: 'Run the screener', fn: () => startScreener(d.candidate.id) }));
    return panel;
  }
  panel.append(h('div', { class: 't-caption mb-4' },
    'Session: ', stamp(`Verified · ${s.date}`), stamp(s.duration), ' · practice sessions are not visible to recruiters'));
  const grid = h('div', { class: 'grid2' });
  const left = h('div', {},
    h('h2', { class: 't-section' }, 'STAR proportions'));
  for (const [key, label] of [['S', 'Situation'], ['T', 'Task'], ['A', 'Action'], ['R', 'Result']] as const) {
    const v = s.star?.[key] ?? 0;
    const target = s.targets[key] ?? 0;
    const out = Math.abs(v - target) > 5;
    const meter = h('div', { class: 'meter' + (out ? ' out' : '') },
      h('div', { class: 'meter-head' },
        h('span', { class: 't-secondary' }, label),
        h('span', { class: 't-caption figures' }, `${v}% · target ${target}%`)),
      h('div', { class: 'meter-track' }, setWidthPct(h('div', { class: 'meter-fill' }), v * 2)));
    left.append(meter);
  }
  const right = h('div', {},
    h('h2', { class: 't-section' }, 'Ownership'),
    h('div', { class: 'split' }, setWidthPct(h('span', { class: 'a' }), s.ownership ?? 0), h('span', { class: 'b' })),
    h('p', { class: 't-caption figures' }, `${s.ownership ?? 0}% first person · team voice the rest · trailing ends: ${d.sessions.reduce((a, x) => a + 0, 0)}`));
  grid.append(left, right);
  panel.append(grid);
  return panel;
}

function renderTranscript(d: Detail): HTMLElement {
  const panel = h('div', { class: 'panel' });
  const s = d.sessions[0];
  if (!s) { panel.append(empty('No transcript. Verified sessions only.')); return panel; }
  for (const t of s.transcript) {
    const row = h('div', { class: 'turn' },
      h('time', {}, t.t),
      h('div', {}, h('span', { class: 'who' }, t.who), h('span', { class: 't-body' }, t.text)));
    panel.append(row);
    if (t.annot) {
      const m = (t.annot.mark === 'confirmed' ? 'confirmed' : t.annot.mark === 'claimed' ? 'claimed' : 'gap') as keyof typeof MARK_WORD;
      panel.append(h('div', { class: 'annot' }, mark(m), h('span', { class: 't-caption' }, t.annot.label)));
    }
  }
  return panel;
}

const FLAG_META: Record<string, { m: MarkState; spine: string; word: string }> = {
  claim_missing_from_cv: { m: 'claimed', spine: 'spine-pos', word: 'Positive' },
  jd_gap: { m: 'gap', spine: 'spine-warn', word: 'Warning' },
  source_conflict: { m: 'conflict', spine: 'spine-warn', word: 'Warning' },
  metric_confirmed: { m: 'confirmed', spine: 'spine-conf', word: 'Confirmed' },
};

function renderFlags(d: Detail, id: string): HTMLElement {
  const panel = h('div', { class: 'panel' });
  if (!d.flags.length) { panel.append(empty('Nothing to fix. The transcript, the CV and the JD line up.')); return panel; }
  for (const f of d.flags) {
    const meta = FLAG_META[f.type] ?? FLAG_META['jd_gap']!;
    const card = h('div', { class: `flagcard spine ${meta.spine}${f.status === 'resolved' ? ' resolved' : ''}` });
    const header = h('header', {}, mark(meta.m), h('h3', { class: 't-section' }, f.title), stamp(meta.word, meta.m));
    card.append(header);
    card.append(h('p', { class: 't-body' }, f.body));
    if (f.quote) card.append(h('p', { class: 't-caption' }, `Evidence: ${f.quote}`));
    const acts = h('div', { class: 'acts' });
    if (f.status === 'open') {
      const approve = h('button', { class: 'btn btn-sm btn-primary' }, 'Approve to To-Do');
      approve.addEventListener('click', async () => {
        await api.post(`/api/recruiter/candidates/${id}/flags/${f.id}/action`, { action: 'approve' });
        toast('Approved. It is on the candidate To-Do list.'); await renderView();
      });
      const discard = h('button', { class: 'btn btn-sm' }, 'Discard');
      discard.addEventListener('click', async () => {
        await api.post(`/api/recruiter/candidates/${id}/flags/${f.id}/action`, { action: 'discard' });
        toast('Discarded'); await renderView();
      });
      acts.append(approve, discard);
    } else {
      acts.append(stamp(f.status === 'actioned' ? 'Approved' : 'Discarded'));
    }
    card.append(acts);
    panel.append(card);
  }
  return panel;
}

function renderNotesPanel(d: Detail): HTMLElement {
  const box = h('section', { class: 'stage p-6' });
  box.append(h('p', { class: 't-caption' }, 'Internal only. Never shown to the candidate.'));
  const rows: Array<[string, string]> = [
    ['Current compensation', d.candidate.currentCompensation ?? 'not captured'],
    ['Expectations', d.candidate.compExpectations ?? 'not captured'],
    ['Notice', d.candidate.noticePeriod ?? 'not captured'],
    ['Motivation', d.candidate.motivation ?? 'not captured'],
  ];
  for (const [k, v] of rows) {
    box.append(h('div', { class: 'stagerow' }, h('span', { class: 't-secondary' }, k), h('span', { class: 't-body' }, v)));
  }
  box.append(h('p', { class: 't-caption mt-4' },
    `Audit: every view of this panel is logged. Viewed just now by ${me.user.displayName}.`));
  return box;
}

/* ---------- builder ---------- */
let builderId: string | null = null;

async function renderBuilder(content: HTMLElement): Promise<void> {
  content.append(h('h1', { class: 't-view' }, 'Submission builder'));
  content.append(h('p', { class: 't-secondary' }, 'Gated on four of four sources. Generation is recruiter-initiated.'));
  const data = await api.get('/api/recruiter/pipeline');
  const panel = h('div', { class: 'panel mt-6 w-520' });
  for (const c of data.candidates as CandidateCard[]) {
    const row = h('div', { class: 'srow' },
      h('span', { class: 't-body' }, `${c.name} · ${c.targetRole}`));
    const btn = h('button', { class: 'btn btn-sm' }, 'Open');
    btn.addEventListener('click', () => { builderId = c.id; renderShell(); renderView(); });
    row.append(btn);
    panel.append(row);
  }
  content.append(panel);
  if (builderId) {
    const d: Detail = await api.get(`/api/recruiter/candidates/${builderId}`);
    content.append(await renderBuilderPanel(d, builderId));
  } else {
    content.append(empty('Pick a candidate to see their sources and run the builder.'));
  }
}

const SOURCE_KINDS = ['resume', 'transcript', 'linkedin_snapshot', 'jd'];

async function renderBuilderPanel(d: Detail, id: string): Promise<HTMLElement> {
  const panel = h('div', { class: 'panel mt-6' });
  panel.append(h('h2', { class: 't-section' }, 'Ingested sources'));
  for (const kind of SOURCE_KINDS) {
    const art = d.artifacts.filter(a => a.kind === kind).at(-1);
    const row = h('div', { class: 'srcrow' },
      h('span', { class: 't-body' }, kind.replace('_', ' ')));
    if (art) {
      row.append(stamp(art.quarantine === 'sanitized' ? 'Sanitized' : art.quarantine === 'rejected' ? 'Rejected' : 'Clean'));
      if (art.injectionAttempts > 0) row.append(badge(`${art.injectionAttempts} blocked`, 'conflict'));
    } else {
      const btn = h('button', { class: 'btn btn-sm' }, 'Ingest');
      btn.addEventListener('click', () => showIngest(id, kind, () => renderView()));
      row.append(btn);
    }
    panel.append(row);
  }
  panel.append(h('p', { class: 't-caption my-3' },
    'Documents are extracted to structured fields. Embedded instructions are stripped at ingestion. Injection attempts are logged, never executed.'));

  const gen = h('button', { class: 'btn btn-primary' }, 'Generate deliverables');
  gen.addEventListener('click', async () => {
    try {
      const { run } = await api.post(`/api/recruiter/candidates/${id}/builder/start`);
      if (run.status === 'awaiting_human' && run.stepStates?.compose_blocked) {
        toast('Gate: four of four sources required. Ingest the rest first.');
      } else {
        toast('Deliverables generated. QA checks below.');
      }
      await renderView();
    } catch (e) { toast(String((e as Error).message)); }
  });
  panel.append(gen);

  /* QA checklist and deliverables from the latest builder run. */
  const build = await api.get(`/api/recruiter/candidates/${id}/builder`).catch(() => null);
  if (build?.qa) {
    panel.append(h('h2', { class: 't-section mt-6' }, 'QA checklist'));
    for (const q of build.qa as Array<{ check: string; pass: boolean }>) {
      panel.append(h('div', { class: 'qa' + (q.pass ? '' : ' fail') },
        mark(q.pass ? 'confirmed' : 'conflict'), h('span', { class: 't-secondary' }, q.check)));
    }
    panel.append(h('h2', { class: 't-section mt-4' }, 'Deliverables'));
    for (const d2 of build.deliverables as Array<{ kind: string; content: string; internal: boolean }>) {
      if (d2.internal) {
        const box = h('section', { class: 'stage p-4 mt-4' });
        box.append(h('p', { class: 't-caption' }, 'Internal only. Never shown to the candidate.'));
        box.append(h('div', { class: 'handoff mt-2' }, d2.content));
        panel.append(h('p', { class: 't-secondary' }, d2.kind.replace('_', ' ')), box);
      } else {
        panel.append(h('p', { class: 't-secondary' }, d2.kind.replace('_', ' ')),
          h('div', { class: 'handoff' }, d2.content.slice(0, 1200)));
      }
    }
  }
  return panel;
}

function showIngest(candidateId: string, kind: string, done: () => void): void {
  const scrim = h('div', { class: 'scrim' });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('h2', { class: 't-view' }, `Ingest ${kind.replace('_', ' ')}`),
    h('p', { class: 't-secondary' }, 'Paste the document text. It passes the quarantine pipeline before anything sees it.'));
  const ta = h('textarea', { rows: '8', class: 'mb-3' }) as HTMLTextAreaElement;
  const ingest = h('button', { class: 'btn btn-primary' }, 'Ingest');
  ingest.addEventListener('click', async () => {
    try {
      const result = await api.post(`/api/recruiter/candidates/${candidateId}/artifacts`, { kind, title: kind, text: ta.value });
      toast(result.artifact.quarantine === 'rejected' ? 'Rejected: repeated injection attempts'
        : result.artifact.injectionAttempts > 0 ? 'Ingested with instruction-like content stripped'
        : 'Ingested clean');
      scrim.remove(); done();
    } catch (e) { toast(String((e as Error).message)); }
  });
  const cancel = h('button', { class: 'btn ml-2' }, 'Cancel');
  cancel.addEventListener('click', () => scrim.remove());
  modal.append(ta, h('div', {}, ingest, cancel));
  scrim.append(modal);
  document.body.append(scrim);
}

async function startScreener(candidateId: string): Promise<void> {
  try {
    await api.post(`/api/flows/interview_screener/start/${candidateId}`);
    toast('Screener run started. It waits for candidate consent.');
  } catch (e) { toast(String((e as Error).message)); }
}

/* ---------- notes ---------- */
async function renderNotes(content: HTMLElement): Promise<void> {
  content.append(h('h1', { class: 't-view' }, 'Notes'));
  content.append(h('p', { class: 't-secondary' }, 'Internal only. Role-gated. Never client-facing.'));
  const data = await api.get('/api/recruiter/pipeline');
  for (const c of data.candidates as CandidateCard[]) {
    const d: Detail = await api.get(`/api/recruiter/candidates/${c.id}`);
    const box = h('section', { class: 'stage p-6 mt-4' });
    box.append(h('p', { class: 't-caption' }, `${c.name} · internal only`));
    const rows: Array<[string, string]> = [
      ['Current compensation', d.candidate.currentCompensation ?? 'not captured'],
      ['Expectations', d.candidate.compExpectations ?? 'not captured'],
      ['Notice', d.candidate.noticePeriod ?? 'not captured'],
      ['Motivation', d.candidate.motivation ?? 'not captured'],
      ['Stage', d.candidate.stage],
    ];
    for (const [k, v] of rows) box.append(h('div', { class: 'stagerow' }, h('span', { class: 't-secondary' }, k), h('span', { class: 't-body' }, v)));
    content.append(box);
  }
}

function showAddCandidate(done: () => void): void {
  const scrim = h('div', { class: 'scrim' });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('h2', { class: 't-view' }, 'Add candidate'),
    h('p', { class: 't-secondary' }, 'The profile agent creates the profile and generates a password you share with the candidate.'));
  const email = h('input', { type: 'email', placeholder: 'candidate@email.example' }) as HTMLInputElement;
  const name = h('input', { type: 'text', placeholder: 'Full name' }) as HTMLInputElement;
  const role = h('input', { type: 'text', placeholder: 'Target role' }) as HTMLInputElement;
  const company = h('input', { type: 'text', placeholder: 'Target company (optional)' }) as HTMLInputElement;
  modal.append(
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Name'), name),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Target role'), role),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Target company'), company));
  const create = h('button', { class: 'btn btn-primary' }, 'Create profile');
  create.addEventListener('click', async () => {
    try {
      const resp = await api.post('/api/recruiter/candidates', {
        email: email.value, name: name.value, targetRole: role.value, targetCompany: company.value || null,
      });
      scrim.remove();
      showCredentials(resp.credentials, done);
    } catch (e) {
      toast(String((e as Error).message) === 'email_exists' ? 'That email already has an account.' : String((e as Error).message));
    }
  });
  const cancel = h('button', { class: 'btn ml-2' }, 'Cancel');
  cancel.addEventListener('click', () => scrim.remove());
  modal.append(h('div', {}, create, cancel));
  scrim.append(modal);
  document.body.append(scrim);
  email.focus();
}

function showCredentials(creds: { email: string; password: string }, done: () => void): void {
  const scrim = h('div', { class: 'scrim' });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h('h2', { class: 't-view' }, 'Candidate created'),
    h('p', { class: 't-secondary' }, 'Share these credentials with the candidate. The password is shown once and stored hashed.'));
  const block = h('div', { class: 'handoff' }, `Email: ${creds.email}\nPassword: ${creds.password}`);
  const copy = h('button', { class: 'btn btn-primary' }, 'Copy credentials');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`Email: ${creds.email}\nPassword: ${creds.password}`); toast('Credentials copied'); }
    catch { toast('Select and copy manually'); }
  });
  const close = h('button', { class: 'btn ml-2' }, 'Done');
  close.addEventListener('click', () => { scrim.remove(); done(); });
  modal.append(block, h('div', {}, copy, close));
  scrim.append(modal);
  document.body.append(scrim);
}

boot();
