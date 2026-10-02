/* Public candidate profile: the one-page insight a recruiter sends to the
   target company (ADR-0022). Unauthenticated by design: the id in the URL
   is the capability token, and the link works only while the candidate's
   approval stands. The candidate and their agency may preview it first.

   Its job is a hiring manager's first minute: how well does this person
   fit the role, and how sure can I be? Every requirement shows its
   evidence and where it came from, and "verified" is reserved for what
   Certainty checked itself. Contact details stay inside the CV download. */
import { h, clear, mark, brandMark, setWidthPct, setLeftPct, sealGauge } from '../shared/dom.js';
import type { MarkState } from '../shared/dom.js';
import { initTheme } from '../shared/theme.js';
import { cvBlocks, type CvTemplateFields } from '../shared/cv-template.js';
import { buildCvPdf } from '../shared/pdf.js';
import { buildCvDocx } from '../shared/docx.js';

interface ProfileFields {
  name: string; headline: string; location: string;
  companies: string[]; highlights: string[];
  skills: Array<{ group: string; items: string[] }>;
  education: string[];
  verified: boolean;
}
type FitStatus = 'verified' | 'claimed' | 'partial' | 'gap';
interface Insight {
  targetRole: string; targetCompany: string | null;
  fit: Array<{ requirement: string; status: FitStatus; sources: string[]; partial: string[] }>;
  fitSummary: { evidenced: number; verified: number; total: number };
  achievements: string[];
  interview: { date: string; star: Record<string, number>; ownership: number | null } | null;
  github: {
    username: string; url: string; verified: boolean; syncedAt: string;
    repos: Array<{ name: string; description: string; language: string | null; stars: number; url: string }>;
    mergedPrCount: number; mergedPrs: Array<{ repo: string; title: string; url: string }>;
    languages: string[]; activeMonths: number;
  } | null;
  leetcode: {
    username: string; url: string; verified: boolean; syncedAt: string;
    solved: { easy: number; medium: number; hard: number; all: number };
    contest: { rating: number; attended: number; topPercentage: number | null } | null;
    badges: string[];
  } | null;
}
interface Payload { profile: ProfileFields; insight: Insight | null; cv: Record<string, unknown> | null; tenantName: string | null; preview: boolean }

const root = document.getElementById('root')!;

const FIT: Record<FitStatus, { mark: MarkState; word: string }> = {
  verified: { mark: 'confirmed', word: 'Verified' },
  claimed: { mark: 'claimed', word: 'Claimed' },
  partial: { mark: 'gap', word: 'Partly evidenced' },
  gap: { mark: 'blocking', word: 'Not evidenced' },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function section(title: string, ...children: Array<Node | string>): HTMLElement {
  return h('section', { class: 'pp-sec' }, h('h2', { class: 'pp-h2' }, title), ...children);
}

function verifiedStamp(ok: boolean): HTMLElement {
  return h('span', { class: 'stamp' }, mark(ok ? 'confirmed' : 'claimed'), ok ? 'Ownership verified' : 'Not verified');
}

function renderNotFound(): void {
  root.append(h('div', { class: 'pp-notfound' },
    h('h1', { class: 't-view' }, 'This link is not available'),
    h('p', { class: 't-secondary' }, 'The candidate may have stopped sharing it, or it has expired. Ask the recruiter for a fresh link.')));
}

function renderProfile(d: Payload): void {
  const p = d.profile;
  const ins = d.insight;

  /* Top bar: brand, and who prepared the page. */
  root.append(h('header', { class: 'pp-top' },
    h('span', { class: 'pp-brand' }, brandMark(20), h('span', {}, 'Certainty')),
    h('span', { class: 't-caption' }, d.tenantName ? `Prepared by ${d.tenantName}` : '')));
  if (d.preview) {
    root.append(h('div', { class: 'pp-preview', role: 'note' },
      'Preview. This page is not shared yet: it works for others only after the candidate approves sharing.'));
  }

  /* Identity and the one-line verdict. */
  /* The certificate: who, for which role, and the seal of how much of the
     role's must-haves the evidence covers. */
  const facts = h('div', { class: 'pp-facts' });
  if (ins?.fitSummary.total) {
    facts.append(h('span', { class: 'stamp' }, mark(ins.fitSummary.verified ? 'confirmed' : 'claimed'),
      `${ins.fitSummary.verified} verified, ${ins.fitSummary.evidenced - ins.fitSummary.verified} claimed`));
  }
  if (ins?.interview) facts.append(h('span', { class: 'stamp' }, mark('confirmed'), `Verified interview, ${ins.interview.date}`));
  const hero = h('div', { class: 'pp-hero guilloche' },
    h('div', { class: 'pp-id' },
      h('h1', { class: 't-display' }, p.name),
      h('p', { class: 't-secondary' }, [p.headline, p.location].filter(Boolean).join(' · ')),
      ins?.targetRole ? h('p', { class: 'pp-target' }, `For the ${ins.targetRole} role${ins.targetCompany ? ` at ${ins.targetCompany}` : ''}`) : '',
      facts));
  if (ins?.fitSummary.total) {
    hero.append(sealGauge(ins.fitSummary.verified, ins.fitSummary.evidenced - ins.fitSummary.verified, ins.fitSummary.total));
  }
  root.append(hero);

  /* Fit: each requirement, its evidence, and where the evidence is from. */
  if (ins && ins.fit.length) {
    const list = h('ul', { class: 'pp-fit' });
    for (const f of ins.fit) {
      const meta = FIT[f.status];
      list.append(h('li', { class: `pp-fit-row is-${f.status}` },
        mark(meta.mark),
        h('div', { class: 'pp-fit-main' },
          h('span', { class: 'pp-fit-req' }, f.requirement),
          h('span', { class: 't-caption' }, f.sources.length ? `Evidence: ${f.sources.join(', ')}`
            : f.partial?.length ? `Partly in: ${f.partial.join(', ')}` : 'No evidence found yet')),
        h('span', { class: 'pp-fit-word' }, meta.word)));
    }
    root.append(section('Fit for this role', list,
      h('p', { class: 'pp-legend t-caption' },
        'Verified means Certainty checked it: in a recorded, consented interview, or on an account whose ownership the candidate proved. Claimed means it is stated in the CV or on an account not yet verified.')));
  }

  if (ins?.achievements.length) {
    const ol = h('ol', { class: 'pp-ach' });
    for (const a of ins.achievements) ol.append(h('li', {}, a));
    root.append(section('Key achievements', ol));
  }

  /* Contributions and problem solving, from connected accounts. */
  const work = h('div', { class: 'pp-grid' });
  if (ins?.github) {
    const g = ins.github;
    const card = h('div', { class: 'pp-card' },
      h('div', { class: 'pp-card-head' }, h('h3', { class: 't-section' }, 'Contributions'), verifiedStamp(g.verified)),
      h('p', { class: 't-caption' }, 'GitHub · ', h('a', { href: g.url, target: '_blank', rel: 'noopener' }, `@${g.username}`)),
      h('div', { class: 'pp-nums' },
        h('div', {}, h('b', { class: 'figures' }, String(g.mergedPrCount)), h('span', { class: 't-caption' }, 'merged PRs to other projects')),
        h('div', {}, h('b', { class: 'figures' }, `${g.activeMonths}/12`), h('span', { class: 't-caption' }, 'active months, last year'))));
    if (g.languages.length) card.append(h('p', { class: 't-caption' }, `Languages: ${g.languages.join(', ')}`));
    const repos = h('ul', { class: 'pp-list' });
    for (const r of g.repos.slice(0, 3)) {
      repos.append(h('li', {}, h('a', { href: r.url, target: '_blank', rel: 'noopener' }, r.name),
        h('span', { class: 't-caption' }, [r.language, r.description].filter(Boolean).join(' · '))));
    }
    for (const pr of g.mergedPrs.slice(0, 2)) {
      repos.append(h('li', {}, h('a', { href: pr.url, target: '_blank', rel: 'noopener' }, pr.repo),
        h('span', { class: 't-caption' }, `Merged: ${pr.title}`)));
    }
    card.append(repos);
    work.append(card);
  }
  if (ins?.leetcode) {
    const l = ins.leetcode;
    const card = h('div', { class: 'pp-card' },
      h('div', { class: 'pp-card-head' }, h('h3', { class: 't-section' }, 'Problem solving'), verifiedStamp(l.verified)),
      h('p', { class: 't-caption' }, 'LeetCode · ', h('a', { href: l.url, target: '_blank', rel: 'noopener' }, `@${l.username}`)),
      h('div', { class: 'pp-nums' },
        h('div', {}, h('b', { class: 'figures' }, String(l.solved.all)), h('span', { class: 't-caption' }, `solved: ${l.solved.easy} easy, ${l.solved.medium} medium, ${l.solved.hard} hard`)),
        l.contest ? h('div', {}, h('b', { class: 'figures' }, String(l.contest.rating)), h('span', { class: 't-caption' }, `contest rating, ${l.contest.attended} contests`)) : ''));
    if (l.badges.length) card.append(h('p', { class: 't-caption' }, `Badges: ${l.badges.join(', ')}`));
    work.append(card);
  }
  if (work.childElementCount) root.append(section('Work you can inspect', work));

  /* The verified interview, in numbers only; no transcript leaves. */
  if (ins?.interview) {
    const targets: Record<string, number> = { S: 15, T: 10, A: 50, R: 25 };
    const names: Record<string, string> = { S: 'Situation', T: 'Task', A: 'Action', R: 'Result' };
    const bars = h('div', { class: 'pp-star' });
    for (const k of ['S', 'T', 'A', 'R']) {
      const v = ins.interview.star[k] ?? 0;
      bars.append(h('div', { class: 'meter' },
        h('div', { class: 'meter-head' }, h('span', { class: 't-secondary' }, names[k]!), h('span', { class: 't-caption figures' }, `${v}% · target ${targets[k]}%`)),
        h('div', { class: 'meter-track' }, setWidthPct(h('div', { class: 'meter-fill' }), v * 2),
          setLeftPct(h('span', { class: 'meter-tick' }), targets[k]! * 2))));
    }
    root.append(section('Structured interview',
      h('p', { class: 't-caption' }, `How the candidate's answers divided between situation, task, action and result, against a strong-answer target.${ins.interview.ownership !== null ? ` ${ins.interview.ownership}% of answers spoke in the first person.` : ''}`),
      bars));
  }

  /* Background: where, what, and education. */
  const bg = h('div', { class: 'pp-bg' });
  if (p.companies.length) bg.append(h('div', {}, h('h3', { class: 't-caption' }, 'Worked with'), h('p', { class: 't-body' }, p.companies.join(', '))));
  if (p.skills.length) bg.append(h('div', {}, h('h3', { class: 't-caption' }, 'Skills'), h('p', { class: 't-body' }, p.skills.flatMap(s => s.items).join(', '))));
  if (p.education.length) bg.append(h('div', {}, h('h3', { class: 't-caption' }, 'Education'), h('p', { class: 't-body' }, p.education.join('; '))));
  if (bg.childElementCount) root.append(section('Background', bg));

  /* The formatted CV travels with the page. */
  const foot = h('footer', { class: 'pp-foot' },
    h('p', { class: 't-secondary' }, d.cv ? 'The full CV, with contact details, is attached.' : 'The full CV follows from the recruiter.'));
  if (d.cv) {
    const fields = d.cv as unknown as CvTemplateFields;
    const base = p.name.replace(/\s+/g, '-');
    const pdf = h('button', { class: 'btn btn-primary' }, 'Download CV (PDF)');
    pdf.addEventListener('click', () => downloadBlob(buildCvPdf(cvBlocks(p.name, fields)), `${base}-CV.pdf`));
    const docx = h('button', { class: 'btn' }, 'Download CV (Word)');
    docx.addEventListener('click', () => downloadBlob(buildCvDocx(cvBlocks(p.name, fields)), `${base}-CV.docx`));
    const print = h('button', { class: 'btn btn-ghost' }, 'Print this page');
    print.addEventListener('click', () => window.print());
    foot.append(h('div', { class: 'pp-actions' }, pdf, docx, print));
  }
  root.append(foot);
}

/* Paper is light: switch tokens for printing, restore afterwards. */
function printInLight(): void {
  let previous: string | null = null;
  window.addEventListener('beforeprint', () => {
    previous = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
  });
  window.addEventListener('afterprint', () => {
    if (previous) document.documentElement.setAttribute('data-theme', previous);
  });
}

async function boot(): Promise<void> {
  initTheme();
  printInLight();
  const id = location.pathname.split('/').filter(Boolean).at(-1) ?? '';
  clear(root);
  let data: Payload;
  try {
    const res = await fetch(`/api/public/profile/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (!res.ok) { renderNotFound(); return; }
    data = await res.json() as Payload;
  } catch {
    renderNotFound();
    return;
  }
  /* A rendering fault is not a missing link: let it surface as an error
     rather than telling the reader the candidate withdrew the page. */
  renderProfile(data);
}

boot();
