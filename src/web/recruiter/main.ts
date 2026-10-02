/* Recruiter app. Dashboards render state; agents never touch the UI (A0). */
import { api, subscribe } from '../shared/api.js';
import { h, mark, stamp, badge, toast, empty, clear, MARK_WORD, setWidthPct, setLeftPct, icon, avatar,
  railHead, railFoot, topbar, setCrumbs, setCrumbRoot, viewHeader, sealGauge,
  uploadDocument, filePicker, DOCUMENT_ERRORS } from '../shared/dom.js';
import type { MarkState, IconName } from '../shared/dom.js';

interface Me { user: { id: string; role: string; displayName: string; tenantId: string }; tenantName: string | null; entitlements: string[]; stages: string[] }
interface CandidateCard { id: string; name: string; targetRole: string; stage: string; parked: boolean; openFlags: number; verifyFlags: number }
interface Detail {
  candidate: { id: string; name: string; targetRole: string; employer: string; tenure: string; stage: string; parked: boolean;
    currentCompensation: string | null; compExpectations: string | null; noticePeriod: string | null; motivation: string | null };
  flags: Array<{ id: string; type: string; status: string; title: string; body: string; quote: string }>;
  sessions: Array<{ id: string; mode: string; status: string; date: string; duration: string; star: Record<string, number> | null;
    targets: Record<string, number>; ownership: number | null; trailing: number | null; transcript: Array<{ t: string; who: string; text: string; annot?: { mark: string; label: string } }> }>;
  tasks: Array<{ id: string; title: string; done: boolean; flagId?: string | null }>;
  artifacts: Array<{ id: string; kind: string; title: string; quarantine: string; injectionAttempts: number; content: string | null; fields: Record<string, unknown> }>;
  suggestion: string | null;
}

let me: Me;
let view = 'pipeline';
let detailId: string | null = null;
const root = document.getElementById('root')!;

const NAV: Array<{ id: string; label: string; module: string; icon: IconName }> = [
  { id: 'pipeline', label: 'Pipeline', module: 'pipeline', icon: 'pipeline' },
  { id: 'builder', label: 'Submission builder', module: 'builder', icon: 'builder' },
  { id: 'notes', label: 'Notes', module: 'notes', icon: 'notes' },
];

function entitled(m: string): boolean { return me.entitlements.includes(m); }

async function boot(): Promise<void> {
  try {
    me = await api.get('/api/me');
    if (me.user.role === 'candidate') { location.href = '/app/candidate'; return; }
    setCrumbRoot(me.tenantName);
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
  const rail = h('aside', { class: 'rail' }, railHead('Recruiter'));
  const nav = h('nav', { class: 'nav', 'aria-label': 'Recruiter' });
  const current = view === 'detail' ? 'pipeline' : view;
  for (const item of NAV) {
    const b = h('button', { class: 'nav-item', 'aria-current': current === item.id ? 'page' : 'false', title: item.label },
      icon(item.icon), h('span', { class: 'lbl' }, item.label));
    if (!entitled(item.module)) b.setAttribute('aria-disabled', 'true');
    else b.addEventListener('click', () => { view = item.id; renderShell(); renderView(); });
    nav.append(b);
  }
  rail.append(nav, railFoot(me.user.displayName, 'Recruiter'));
  const main = h('main', {}, topbar(), h('div', { class: 'content', id: 'content' }));
  app.append(rail, main);
  root.append(app);
}

async function renderView(): Promise<void> {
  const content = document.getElementById('content');
  if (!content) return;
  clear(content);
  const label = NAV.find(n => n.id === view)?.label;
  if (label) setCrumbs([{ label }]);
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
  const addBtn = h('button', { class: 'btn btn-primary' }, icon('plus'), 'Add candidate');
  addBtn.addEventListener('click', () => showAddCandidate(() => renderView()));
  content.append(viewHeader('Pipeline',
    'One stage per advance. Stage suggestions come from the stage advisor; humans advance.', [addBtn]));
  const board = h('div', { class: 'board mt-6' });
  for (const stage of data.stages as string[]) {
    const cards = (data.candidates as CandidateCard[]).filter(c => c.stage === stage);
    /* The count belongs in the header: a recruiter reads pipeline shape
       before reading any single card. */
    const col = h('section', { class: cards.length ? 'bcol' : 'bcol is-empty', 'aria-label': `${stage}, ${cards.length} candidates` },
      h('div', { class: 'colhead' },
        h('span', { class: 't-section' }, stage),
        h('span', { class: 'colcount' }, String(cards.length))));
    const stack = h('div', { class: 'bstack' });
    col.append(stack);
    if (!cards.length) stack.append(h('p', { class: 'bempty' }, 'No candidates'));
    for (const c of cards) {
      const card = h('div', { class: `pcard reveal-host${c.parked ? ' is-parked' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${c.name}, open detail` });
      card.append(h('div', { class: 'pcard-top' }, avatar(c.name),
        h('div', {}, h('div', { class: 'nm' }, c.name), h('div', { class: 't-caption' }, c.targetRole))));
      const badges = h('div', { class: 'badges' });
      if (c.openFlags > 0) badges.append(badge(`${c.openFlags} flags`, 'gap'));
      if (c.verifyFlags > 0) badges.append(badge('verify', 'conflict'));
      if (c.openFlags === 0 && c.verifyFlags === 0) badges.append(stamp('synced'));
      const reveal = h('span', { class: 'reveal card-acts' });
      /* Say where Advance goes; a bare verb on a card is a guess. */
      const nextStage = (data.stages as string[])[(data.stages as string[]).indexOf(stage) + 1];
      if (!c.parked && nextStage) {
        const adv = h('button', { class: 'btn btn-sm', title: `Advance ${c.name} to ${nextStage}` }, `To ${nextStage}`);
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
      card.append(h('div', { class: 'pcard-foot' }, badges, reveal));
      card.addEventListener('click', () => { detailId = c.id; view = 'detail'; renderShell(); renderView(); });
      card.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') card.click(); });
      stack.append(card);
    }
    board.append(col);
  }
  content.append(board);
}

/* ---------- candidate detail ---------- */
interface Insight {
  targetCompany: string | null;
  fit: Array<{ requirement: string; status: 'verified' | 'claimed' | 'partial' | 'gap'; sources: string[]; partial?: string[] }>;
  fitSummary: { evidenced: number; verified: number; total: number };
}
interface JourneyView { onboarding: string; research: string; roles: Array<{ done: boolean }>; rolesDone: boolean; cv: string; linkedin: string; interview: string }
let lastInsight: Insight | null = null;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* 2026-11-01 reads as "1 Nov 2026" on a certificate. */
function fmtDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (iso ?? '');
}

function word(state: string): string {
  return state ? state.charAt(0).toUpperCase() + state.slice(1) : 'Pending';
}


async function renderDetail(content: HTMLElement, id: string): Promise<void> {
  const d: Detail = await api.get(`/api/recruiter/candidates/${id}`);
  setCrumbs([
    { label: 'Pipeline', onClick: () => { view = 'pipeline'; renderShell(); renderView(); } },
    { label: d.candidate.name },
  ]);
  const openFlags = d.flags.filter(f => f.status === 'open');
  const conflicts = openFlags.filter(f => f.type === 'source_conflict').length;

  const [insightResp, jr] = await Promise.all([
    api.get(`/api/recruiter/candidates/${id}/insight`).catch(() => null) as Promise<{ insight: Insight | null; page: { live: boolean; share: { expiresAt: string | null } } | null } | null>,
    api.get(`/api/recruiter/candidates/${id}/journey`).then(r => r.journey).catch(() => null) as Promise<JourneyView | null>,
  ]);
  const insight = insightResp?.insight ?? null;
  lastInsight = insight;
  const fs = insight?.fitSummary ?? { evidenced: 0, verified: 0, total: 0 };
  const verifiedSession = d.sessions.find(s => s.mode === 'verified');

  /* The certificate: who, how sure (the seal), and the facts, mirrored
     around the seal; the stamps and actions run along its foot. */
  const tags = h('div', { class: 'tags' }, h('span', { class: 'tag ink' }, d.candidate.stage));
  if (insight?.targetCompany) tags.append(h('span', { class: 'tag' }, `For ${insight.targetCompany}`));
  const page = insightResp?.page;
  tags.append(h('span', { class: 'tag' }, !page ? 'Profile not generated yet'
    : page.live ? `Profile shared until ${fmtDay(page.share.expiresAt)}` : page.share.expiresAt ? 'Profile link expired' : 'Awaiting candidate approval to share'));
  const who = h('div', { class: 'who' },
    h('h1', { class: 't-display' }, d.candidate.name),
    h('p', {}, [d.candidate.targetRole, d.candidate.employer, d.candidate.tenure].filter(Boolean).join(' · ')),
    tags);
  const facts = h('dl', { class: 'facts' },
    h('div', {}, h('dt', {}, 'Verified'), h('dd', {}, String(fs.verified))),
    h('div', {}, h('dt', {}, 'Claimed'), h('dd', {}, String(fs.evidenced - fs.verified))),
    h('div', {}, h('dt', {}, 'Open flags'), h('dd', {}, String(openFlags.length))),
    h('div', {}, h('dt', {}, 'Interview'), h('dd', {}, verifiedSession?.duration || 'None')));
  const stamps = h('div', { class: 'cert-stamps' });
  stamps.append(verifiedSession
    ? h('span', {}, mark('confirmed'), `Verified interview, ${fmtDay(verifiedSession.date)}`)
    : h('span', {}, 'No verified interview yet'));
  if (jr) stamps.append(h('span', {}, `Roles revamped ${jr.roles.filter(r => r.done).length} of ${jr.roles.length}`),
    h('span', {}, jr.cv === 'complete' && jr.linkedin === 'complete' ? 'CV and LinkedIn complete' : `CV ${jr.cv}, LinkedIn ${jr.linkedin}`));
  if (conflicts > 0) stamps.append(h('span', {}, mark('conflict'), `${conflicts === 1 ? 'One source conflict' : `${conflicts} source conflicts`}, conservative dates in use`));
  if (d.suggestion) stamps.append(h('span', {}, mark('claimed'), `Stage advisor suggests ${d.suggestion}`));
  const acts = renderProfileShare(d);
  const next = d.suggestion ?? me.stages[me.stages.indexOf(d.candidate.stage) + 1];
  if (next && !d.candidate.parked) {
    const adv = h('button', { class: 'btn btn-primary' }, `Advance to ${next}`);
    adv.addEventListener('click', async () => {
      try { await api.post(`/api/recruiter/candidates/${id}/advance`); toast('Stage advanced'); await renderView(); }
      catch (err) { toast(String((err as Error).message)); }
    });
    acts.append(adv);
  }
  content.append(h('section', { class: 'panel cert guilloche', 'aria-label': `${d.candidate.name}, summary` },
    h('div', { class: 'cert-in' }, who, sealGauge(fs.verified, fs.evidenced - fs.verified, fs.total), facts),
    h('div', { class: 'cert-foot' }, stamps, acts)));

  /* The journey as numbered cells, one per gate. */
  if (jr) {
    const steps: Array<[string, string, boolean]> = [
      ['Setup', word(jr.onboarding), jr.onboarding === 'complete'],
      ['Research', word(jr.research), jr.research === 'complete'],
      ['Resume', `${jr.roles.filter(r => r.done).length} of ${jr.roles.length} roles`, jr.rolesDone],
      ['CV', jr.cv === 'complete' ? 'Assembled' : 'Pending', jr.cv === 'complete'],
      ['LinkedIn', word(jr.linkedin), jr.linkedin === 'complete'],
      ['Interview', verifiedSession ? 'Verified, scored' : word(jr.interview), !!verifiedSession],
    ];
    const nowIndex = steps.findIndex(([, , done]) => !done);
    const ol = h('ol', { class: 'journey mt-6', 'aria-label': 'Journey' });
    steps.forEach(([label, cap, done], i) => {
      const state = done ? 'is-done' : i === nowIndex ? 'is-now' : 'is-locked';
      ol.append(h('li', { class: `jstep ${state}` }, h('span', { class: 'jlabel' }, label), h('span', { class: 'jcap' }, cap),
        h('span', { class: 'sr-only' }, done ? ' (complete)' : i === nowIndex ? ' (current)' : ' (not reached)')));
    });
    content.append(ol);
  }

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Candidate evidence' });
  const panels: Record<string, HTMLElement> = {};
  const tabDefs: Array<[string, string, number?]> = [
    ['ins', 'Insights'], ['tr', 'Transcript'], ['fl', 'Gap flags', openFlags.length], ['nt', 'Notes'],
  ];
  const tabEls: HTMLElement[] = [];
  const select = (key: string, focus = false): void => {
    tabDefs.forEach(([k], i) => {
      const on = k === key;
      panels[k]!.hidden = !on;
      tabEls[i]!.setAttribute('aria-selected', on ? 'true' : 'false');
      tabEls[i]!.setAttribute('tabindex', on ? '0' : '-1');
      if (on && focus) tabEls[i]!.focus();
    });
  };
  for (const [key, label, count] of tabDefs) {
    const t = h('button', { class: 'tab', role: 'tab', id: `tab-${key}`, 'aria-controls': `panel-${key}` }, label);
    if (count) t.append(h('span', { class: 'tab-count' }, String(count)));
    t.addEventListener('click', () => select(key));
    /* Roving tabindex: arrows move between tabs, Home and End jump. */
    t.addEventListener('keydown', e => {
      const k = (e as KeyboardEvent).key;
      const i = tabDefs.findIndex(x => x[0] === key);
      const next = k === 'ArrowRight' ? (i + 1) % tabDefs.length : k === 'ArrowLeft' ? (i - 1 + tabDefs.length) % tabDefs.length
        : k === 'Home' ? 0 : k === 'End' ? tabDefs.length - 1 : -1;
      if (next >= 0) { e.preventDefault(); select(tabDefs[next]![0], true); }
    });
    tabEls.push(t);
    tabs.append(t);
  }
  content.append(tabs);

  panels['ins'] = renderInsights(d);
  panels['tr'] = renderTranscript(d);
  panels['fl'] = renderFlags(d, id);
  panels['nt'] = renderNotesPanel(d);
  for (const [k] of tabDefs) {
    panels[k]!.setAttribute('role', 'tabpanel');
    panels[k]!.id = `panel-${k}`;
    panels[k]!.setAttribute('aria-labelledby', `tab-${k}`);
    content.append(panels[k]!);
  }
  select('ins');

}

/* Shareable candidate profile: generated by the same agent block that
   assembles the CV, once every role has been revamped. One link, no
   login. It is an action on the candidate, so it lives in the header. */
function renderProfileShare(d: Detail): HTMLElement {
  const acts = h('div', { class: 'dhead-acts' });
  /* One place for the submission builder: the detail page links to it
     rather than repeating it under every tab. */
  const builder = h('button', { class: 'btn' }, icon('builder'), 'Submission builder');
  builder.addEventListener('click', () => { builderId = d.candidate.id; view = 'builder'; renderShell(); renderView(); });
  acts.append(builder);
  const page = d.artifacts.filter(a => a.kind === 'profile_page').at(-1);
  if (!page) {
    acts.append(h('span', { class: 't-caption' }, 'Profile page generates once every role is complete.'));
    return acts;
  }
  /* The link works only while the candidate's approval stands. */
  const share = (page.fields.share ?? {}) as { enabled?: boolean; expiresAt?: string };
  const live = !!share.enabled && !!share.expiresAt && Date.parse(share.expiresAt) > Date.now();
  const url = `${location.origin}/p/${page.id}`;
  const open = h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, icon('external'), live ? 'Open profile' : 'Preview profile');
  /* The sharing state is shown as a tag in the certificate header. */
  if (!live) {
    acts.append(open);
    return acts;
  }
  const copy = h('button', { class: 'btn btn-primary', title: url }, icon('link'), 'Copy profile link');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast(`Link copied. It works until ${share.expiresAt!.slice(0, 10)}.`); }
    catch { toast(`Copy manually: ${url}`); }
  });
  const revoke = h('button', { class: 'btn btn-ghost' }, 'Revoke link');
  revoke.addEventListener('click', async () => {
    if (!confirm('Revoke the profile link? Anyone holding it loses access at once.')) return;
    await api.post(`/api/recruiter/candidates/${d.candidate.id}/profile/revoke`);
    toast('Link revoked'); await renderView();
  });
  acts.append(copy, open, revoke);
  return acts;
}

/* Portfolio evidence: connected accounts, marked claimed or verified. */
async function renderPortfolioEvidence(id: string): Promise<HTMLElement | null> {
  const { connectors } = await api.get(`/api/recruiter/candidates/${id}/connectors`).catch(() => ({ connectors: [] })) as
    { connectors: Array<{ provider: string; linked: boolean; username: string; url: string; verified: boolean; syncedAt: string | null; snapshot: any }> };
  const linked = connectors.filter(c => c.linked);
  if (!linked.length) return null;
  const box = h('section', { class: 'panel mt-6' }, h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Work you can inspect'), h('span', { class: 'eyebrow' }, 'Connected accounts')));
  for (const c of linked) {
    const s = c.snapshot;
    const figures = !s ? 'Not synced yet'
      : c.provider === 'github'
        ? `${s.repos.length} own repositories · ${s.mergedPrs.length} merged PRs to other projects · active ${s.activeMonths} of the last 12 months${s.languages.length ? ` · ${s.languages.slice(0, 4).map((l: any) => l.name).join(', ')}` : ''}`
        : `${s.solved.all} problems solved (${s.solved.easy} easy, ${s.solved.medium} medium, ${s.solved.hard} hard)${s.contest ? ` · contest rating ${s.contest.rating}` : ''}`;
    box.append(h('div', { class: 'srow' },
      h('div', {},
        h('div', { class: 't-body row gap-2' }, mark(c.verified ? 'confirmed' : 'claimed'),
          `${c.provider === 'github' ? 'GitHub' : 'LeetCode'} · `, h('a', { href: c.url, target: '_blank', rel: 'noopener' }, `@${c.username}`)),
        h('div', { class: 't-caption' }, figures)),
      stamp(c.verified ? 'Ownership verified' : 'Claimed, not verified', c.verified ? 'confirmed' : 'claimed')));
  }
  return box;
}

const FIT_MARK: Record<string, { mark: MarkState; word: string }> = {
  verified: { mark: 'confirmed', word: 'Verified' },
  claimed: { mark: 'claimed', word: 'Claimed' },
  partial: { mark: 'gap', word: 'Partly' },
  gap: { mark: 'blocking', word: 'Gap' },
};

/* Insights: the requirement table beside the structured interview, then
   connected work. The table is the same insight the shared profile shows. */
function renderInsights(d: Detail): HTMLElement {
  const wrap = h('div', {});
  const grid = h('div', { class: 'grid-75' });

  const fit = h('section', { class: 'panel' });
  const rows = lastInsight?.fit ?? [];
  fit.append(h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Fit for the role'),
    h('span', { class: 'eyebrow' }, lastInsight?.targetCompany ? `${lastInsight.targetCompany} JD, ${rows.length} must-haves` : `${rows.length} must-haves`)));
  if (!rows.length) {
    fit.append(empty('No must-haves found in the job description yet.'));
  } else {
    const table = h('div', { class: 'fit' });
    for (const r of rows) {
      const meta = FIT_MARK[r.status] ?? FIT_MARK.gap!;
      table.append(h('div', { class: 'fit-row' }, mark(meta.mark),
        h('div', {}, h('div', { class: 'req' }, r.requirement),
          h('div', { class: 'src' }, r.sources.length ? r.sources.join(', ') : r.partial?.length ? `Partly in ${r.partial.join(', ')}` : 'No evidence found')),
        h('span', { class: `verdict is-${r.status}` }, meta.word)));
    }
    fit.append(table, h('div', { class: 'legend' },
      h('span', {}, mark('confirmed'), 'Verified by Certainty'), h('span', {}, mark('claimed'), 'Claimed'),
      h('span', {}, mark('gap'), 'Partly evidenced'), h('span', {}, mark('blocking'), 'Gap')));
  }

  const iv = h('section', { class: 'panel' });
  const s = d.sessions[0];
  if (!s) {
    iv.append(h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Structured interview')),
      empty('No verified sessions yet. Practice sessions stay private to the candidate.',
        { label: 'Run the screener', fn: () => startScreener(d.candidate.id) }));
  } else {
    iv.append(h('div', { class: 'panel-head' }, h('h2', { class: 't-section' }, 'Structured interview'),
      h('span', { class: 'eyebrow' }, `${fmtDay(s.date)}, ${s.duration}`)));
    for (const [key, label] of [['S', 'Situation'], ['T', 'Task'], ['A', 'Action'], ['R', 'Result']] as const) {
      const v = s.star?.[key] ?? 0;
      const target = s.targets[key] ?? 0;
      const out = Math.abs(v - target) > 5;
      iv.append(h('div', { class: 'meter' + (out ? ' out' : '') },
        h('div', { class: 'meter-head' },
          h('span', { class: 't-secondary' }, label),
          h('span', { class: 't-caption figures' }, `${v}% · target ${target}`)),
        /* The track spans 0 to 50%, so the widest target (Action, 50) fills it. */
        h('div', { class: 'meter-track' },
          setWidthPct(h('div', { class: 'meter-fill' }), v * 2),
          setLeftPct(h('span', { class: 'meter-tick', title: `Target ${target}%` }), target * 2))));
    }
    iv.append(h('dl', { class: 'facts facts-left mt-6' },
      h('div', {}, h('dt', {}, 'Ownership'), h('dd', {}, `${s.ownership ?? 0}%`)),
      h('div', {}, h('dt', {}, 'Trailing ends'), h('dd', {}, String(s.trailing ?? 'n/a')))),
      h('p', { class: 't-caption mt-3' }, 'Practice sessions are never visible to recruiters.'));
  }
  grid.append(fit, iv);
  wrap.append(grid);
  void renderPortfolioEvidence(d.candidate.id).then(box => { if (box) wrap.append(box); });
  return wrap;
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
  const panel = h('div', {});
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
      /* An approved flag became a candidate task; show where it stands.
         "Fixed" is the candidate's word, so the recruiter is told to check. */
      const task = d.tasks.find(t => t.flagId === f.id);
      if (f.status !== 'actioned') acts.append(stamp('Discarded'));
      else if (task?.done) acts.append(stamp('Candidate says fixed. Check the CV', 'claimed'));
      else acts.append(stamp('Approved. Waiting on the candidate'));
    }
    card.append(acts);
    panel.append(card);
  }
  return panel;
}

function renderNotesPanel(d: Detail): HTMLElement {
  const box = h('div', { class: 'stage p-6' });
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
  content.append(viewHeader('Submission builder', 'Gated on four of four sources. Generation is recruiter-initiated.'));
  const data = await api.get('/api/recruiter/pipeline');
  const panel = h('div', { class: 'panel mt-6 w-520' });
  for (const c of data.candidates as CandidateCard[]) {
    const row = h('div', { class: 'srow' },
      h('span', { class: 't-body' }, `${c.name} · ${c.targetRole}`));
    const btn = h('button', { class: 'btn btn-sm', 'aria-pressed': builderId === c.id ? 'true' : 'false' }, builderId === c.id ? 'Open now' : 'Open');
    btn.addEventListener('click', () => { builderId = c.id; renderShell(); renderView(); });
    row.append(btn);
    panel.append(row);
  }
  content.append(panel);
  if (builderId) {
    const d: Detail = await api.get(`/api/recruiter/candidates/${builderId}`);
    content.append(await renderBuilderPanel(d, builderId));
  } else {
    content.append(h('div', { class: 'mt-6' }, empty('Pick a candidate to see their sources and run the builder.')));
  }
}

const SOURCE_KINDS = ['resume', 'transcript', 'linkedin_snapshot', 'jd'];
const SOURCE_LABEL: Record<string, string> = {
  resume: 'Resume', transcript: 'Transcript', linkedin_snapshot: 'LinkedIn snapshot', jd: 'Job description',
};

async function renderBuilderPanel(d: Detail, id: string): Promise<HTMLElement> {
  const panel = h('div', { class: 'panel mt-6' });
  panel.append(h('h2', { class: 't-section' }, 'Ingested sources'));
  for (const kind of SOURCE_KINDS) {
    const art = d.artifacts.filter(a => a.kind === kind).at(-1);
    const src = (art?.fields.source ?? {}) as { filename?: string; uploadedBy?: string };
    const row = h('div', { class: 'srcrow' },
      h('div', { class: 'srcrow-main' }, h('span', { class: 't-body' }, SOURCE_LABEL[kind] ?? kind),
        src.filename ? h('span', { class: 't-caption' }, `${src.filename}${src.uploadedBy ? ` · added by ${src.uploadedBy}` : ''}`) : ''));
    const recorded = kind === 'transcript' && d.sessions.some(s => s.mode === 'verified' && s.status !== 'stopped' && s.transcript.length > 0);
    const linkOnly = kind === 'linkedin_snapshot' && !art && d.artifacts.some(a => a.kind === 'linkedin_link');
    if (art) {
      row.append(stamp(art.quarantine === 'sanitized' ? 'Sanitized' : art.quarantine === 'rejected' ? 'Rejected' : 'Clean'));
      if (art.injectionAttempts > 0) row.append(badge(`${art.injectionAttempts} blocked`, 'conflict'));
    } else if (recorded) {
      /* The platform's own verified interview counts; nothing to paste. */
      row.append(stamp('Recorded verified interview', 'confirmed'));
    } else if (kind === 'resume' || kind === 'jd') {
      row.append(filePicker(kind === 'resume' ? 'Upload CV' : 'Upload file', async f => {
        try { await uploadDocument(`/api/recruiter/candidates/${id}/documents`, kind, f); toast(`${SOURCE_LABEL[kind]} added`); await renderView(); }
        catch (e) { toast(DOCUMENT_ERRORS[String((e as Error).message)] ?? 'Upload failed. Try again.'); }
      }));
      if (kind === 'jd') {
        const paste = h('button', { class: 'btn btn-sm' }, 'Paste text');
        paste.addEventListener('click', () => showIngest(id, kind, () => renderView()));
        row.append(paste);
      }
    } else {
      if (linkOnly) row.append(h('span', { class: 't-caption' }, 'Only the profile URL is on file. Paste the profile text to run the date cross-check.'));
      const btn = h('button', { class: 'btn btn-sm' }, 'Paste text');
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
    h('h2', { class: 't-view' }, `Ingest source: ${SOURCE_LABEL[kind] ?? kind}`),
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
  content.append(viewHeader('Notes', 'Internal only. Role-gated. Never client-facing.'));
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
  const jd = h('textarea', { rows: '4', placeholder: 'Paste the client job description (optional, recommended)' }) as HTMLTextAreaElement;
  let cvFile: File | null = null;
  const cvName = h('span', { class: 't-caption' }, 'No file chosen');
  const cvPick = filePicker('Choose CV', f => { cvFile = f; cvName.textContent = f.name; });
  modal.append(
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Name'), name),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Target role'), role),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Target company'), company),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'Job description'),
      h('span', { class: 't-caption' }, 'Attached here, the candidate is never asked for it.'), jd),
    h('div', { class: 'field' }, h('label', { class: 't-secondary' }, 'CV (optional)'),
      h('span', { class: 't-caption' }, 'PDF or Word. Uploaded once; the candidate sees it is on file.'),
      h('div', { class: 'row gap-2' }, cvPick, cvName)));
  const create = h('button', { class: 'btn btn-primary' }, 'Create profile');
  create.addEventListener('click', async () => {
    try {
      const resp = await api.post('/api/recruiter/candidates', {
        email: email.value, name: name.value, targetRole: role.value, targetCompany: company.value || null, jd: jd.value,
      });
      if (cvFile) {
        try { await uploadDocument(`/api/recruiter/candidates/${resp.candidateId}/documents`, 'resume', cvFile); }
        catch (e) { toast(DOCUMENT_ERRORS[String((e as Error).message)] ?? 'The profile was created, but the CV upload failed. Add it from the builder.'); }
      }
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
    h('p', { class: 't-secondary' }, 'Send these to the candidate. The password is temporary and shown only once: the candidate replaces it with their own at first sign-in, so you will not know it.'));
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
