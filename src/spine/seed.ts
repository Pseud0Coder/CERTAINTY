/* Seed scenario (master prompt section 15). Fictional, self-consistent.
   The demo loop: verified session with STAR data, one flag of each type, a
   source conflict with the conservative version used, a confirmed metric,
   one JD must-have unevidenced. Second tenant proves isolation (L9). */
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import type { Store } from './db.ts';
import { FLOW_DEFS } from './flows/defs.ts';
import { seedPrompts } from './flows/prompts.ts';
import { quarantine } from './quarantine.ts';
import { assembleCv, assembleProfilePage, parseResume } from './agents.ts';
import type { Candidate, InterviewSession } from './types.ts';
import { seedHiring } from './seed-hiring.ts';

export const DEMO_PASSWORD = 'certainty-demo';

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64).toString('hex');
  return candidate.length === hash.length &&
    cryptoTimingSafe(candidate, hash);
}
function cryptoTimingSafe(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const RESUME_RAW = `Nadia Rowe
Senior Software Engineer, FinTech
London, UK | +44 20 7946 0000 | nadia.rowe@example.com
SKILLS
Engineering: API design | SQL optimization | QA automation | TypeScript
Leadership: Workstream coordination | Mentoring
TOOLS
Docker CI, PostgreSQL
EDUCATION
BSc Computer Science, University of Leeds, 2015
EXPERIENCE
Northline QA Labs | Senior Software Engineer | 07/2019 - 10/2020 | single
- Led WCAG compliance automation: built the assessment framework and exposed it as a REST API, cutting manual audit cycles from weeks to hours.
- Optimized high-volume scanning: implemented async multithreaded processing with SQL query tuning, reducing processing time by 30%.
- Coordinated a four-engineer QA workstream: ran day-to-day delivery while reporting into engineering management.
Meridian Systems | Software Engineer | 05/2017 - 06/2019 | single
- Built billing integrations for B2B SaaS clients, cutting reconciliation effort noticeably.
- Maintained the migration from a monolith to modular services with zero data loss.
Ardent Digital | Junior Software Engineer | 08/2015 - 04/2017 | single
- Shipped customer-facing web features in two-week cycles.
- Wrote the first automated test suite for the payments module.`;

const LINKEDIN_RAW = `Nadia Rowe
Senior Software Engineer at Northline QA Labs
Experience
Northline QA Labs
Senior Software Engineer
07/2019 - 10/2022
Skills: API design, QA automation, SQL`;

const JD_RAW = `Client job description: Senior Software Engineer, FinTech platform.
Must-have: Kubernetes production experience.
Must-have: REST API design at scale.
Must-have: SQL optimization for high-volume systems.
Nice to have: compliance or audit domain experience.`;

const TRANSCRIPT_RAW = `00:41 Interviewer: Tell me about the accessibility automation project. What did you personally own?
01:03 Nadia: The team ran manual WCAG audits, which took weeks. I built the assessment framework and exposed it as a REST API so the checks ran automatically.
02:15 Interviewer: You said "coordinated four engineers". Formal team or project ownership?
02:31 Nadia: Project ownership. They reported to my manager, but I ran the workstream day to day. After the SQL work, processing time dropped by about 30%.
04:02 Interviewer: The client JD lists Kubernetes as a must-have. Where have you run it?
04:10 Nadia: I have not, honestly. We had containerized CI, but I never owned the clusters.
04:58 Nadia: So that was basically it.`;

const TRANSCRIPT_TURNS = [
  { t: '00:41', who: 'Interviewer', text: 'Tell me about the accessibility automation project. What did you personally own?' },
  { t: '01:03', who: 'Nadia', text: 'The team ran manual WCAG audits, which took weeks. I built the assessment framework and exposed it as a REST API so the checks ran automatically.',
    annot: { mark: 'claimed', label: 'Claim logged: framework ownership' } },
  { t: '02:15', who: 'Interviewer', text: 'You said "coordinated four engineers". Formal team or project ownership?' },
  { t: '02:31', who: 'Nadia', text: 'Project ownership. They reported to my manager, but I ran the workstream day to day. After the SQL work, processing time dropped by about 30%.',
    annot: { mark: 'confirmed', label: 'Metric confirmed, matches CV' } },
  { t: '04:02', who: 'Interviewer', text: 'The client JD lists Kubernetes as a must-have. Where have you run it?' },
  { t: '04:10', who: 'Nadia', text: 'I have not, honestly. We had containerized CI, but I never owned the clusters.',
    annot: { mark: 'gap', label: 'JD gap logged' } },
  { t: '04:58', who: 'Nadia', text: 'So that was basically it.',
    annot: { mark: 'gap', label: 'Trailing end noted' } },
];

/* Priya Anand: halfway through onboarding. Her target and documents are
   in (job description, resume), but she has not submitted her LinkedIn
   yet, so the research step has not fired and the onboarding gate is
   still pending, one step short of complete. */
const RESUME_RAW_PRIYA = `Priya Anand
DevOps Engineer, Platform
Manchester, UK | +44 161 496 0000 | priya.anand@example.com
SKILLS
Engineering: CI/CD pipelines | Infrastructure as code | Container orchestration
Leadership: On-call rotation design
TOOLS
Terraform, Kubernetes
EDUCATION
BEng Computer Engineering, University of Manchester, 2018
EXPERIENCE
Vector Cloud | DevOps Engineer | 03/2021 - 09/2026 | single
- Migrated deployment pipelines to a container platform, cutting release time from days to hours.
- Wrote the infrastructure as code baseline now used across every service team.
Harrow Systems | Site Reliability Engineer | 06/2018 - 02/2021 | single
- Reduced incident response time by building a shared on-call runbook.
- Automated recurring capacity checks that previously took a full day each month.`;

const JD_RAW_PRIYA = `Client job description: DevOps Engineer, Platform team.
Must-have: Kubernetes in production.
Must-have: Infrastructure as code experience.
Nice to have: On-call leadership experience.`;

export interface SeedIds {
  tenantId: string; adminId: string; recruiterId: string; candidateUserId: string;
  candidateId: string; consentId: string; sessionId: string;
  tenant2Id: string;
}

export function seedDemo(store: Store): SeedIds {
  const now = () => new Date().toISOString();
  const pw = hashPassword(DEMO_PASSWORD);

  const tenant = store.createTenant('Gennext Recruitments');
  const ctx = { tenantId: tenant.id };
  const admin = store.createUser(tenant.id, 'admin@gennext.demo', pw, 'admin', 'A. Mensah');
  const recruiter = store.createUser(tenant.id, 'recruiter@gennext.demo', pw, 'recruiter', 'R. Osei');
  const candUser = store.createUser(tenant.id, 'nadia@gennext.demo', pw, 'candidate', 'Nadia Rowe');

  const candidate: Candidate = {
    id: randomUUID(), tenantId: tenant.id, userId: candUser.id,
    name: 'Nadia Rowe', targetRole: 'Senior Software Engineer, FinTech',
    targetCompany: 'Ledgerline',
    employer: 'Northline QA Labs', tenure: '07/2019 - 10/2020',
    cvTenureStart: '08/2015', cvTenureEnd: '10/2020',
    stage: 'Screening', parked: false, linkedinStatus: 'synced',
    currentCompensation: '68,000 GBP', compExpectations: '75,000 to 80,000 GBP',
    noticePeriod: '4 weeks', motivation: 'Platform work, away from agency accounts',
    createdAt: now(),
  };
  store.insertCandidate(candidate);

  /* Ingestion through the quarantine pipeline (L1) for every document. */
  quarantine(store, ctx, { candidateId: candidate.id, kind: 'resume', title: 'Nadia Rowe resume', raw: RESUME_RAW, createdBy: recruiter.id });
  quarantine(store, ctx, { candidateId: candidate.id, kind: 'linkedin_snapshot', title: 'LinkedIn snapshot', raw: LINKEDIN_RAW, createdBy: recruiter.id });
  quarantine(store, ctx, { candidateId: candidate.id, kind: 'jd', title: 'Client job description', raw: JD_RAW, createdBy: recruiter.id });
  const tr = quarantine(store, ctx, { candidateId: candidate.id, kind: 'transcript', title: 'Screening transcript', raw: TRANSCRIPT_RAW, createdBy: recruiter.id });

  /* Journey demo state: Nadia is the "completed" reference profile. Research
     is complete, every role has been revamped, and the CV below is exactly
     what agentCvAssembler would produce from that state (assembleCv is
     shared with the live pipeline, so the two can never drift apart).
     Note: this seeded verified session predates the journey gates and exists
     so the recruiter surfaces have evidence to render on first boot. */
  store.insertArtifact({
    id: randomUUID(), tenantId: tenant.id, candidateId: candidate.id,
    kind: 'research_report', title: 'Research report', quarantine: 'clean',
    fields: {
      summary: { good: 2, improve: 2, needs_work: 1 },
      findings: [
        { kind: 'good', title: 'Covered: REST API design at scale', detail: 'REST API appears in your CV evidence.' },
        { kind: 'good', title: 'Covered: SQL optimization', detail: 'SQL appears in your CV evidence.' },
        { kind: 'improve', title: 'Partial: Kubernetes production experience', detail: 'Docker found, but Kubernetes and production are not evidenced yet.' },
        { kind: 'improve', title: 'Add numbers: Meridian Systems', detail: 'The bullets carry no measurable outcome.' },
        { kind: 'needs_work', title: 'Not evidenced: compliance audit ownership', detail: 'No term from this requirement appears in your CV.' },
      ],
    },
    sanitizedText: null, content: 'Research report for Nadia Rowe',
    injectionAttempts: 0, createdBy: 'system', createdAt: now(),
  });
  const handoffFields = [
    { roleKey: '0:Northline QA Labs', bullets: [
      'Led WCAG compliance automation: built the assessment framework and exposed it as a REST API, cutting manual audit cycles from weeks to hours.',
      'Optimized high-volume scanning: implemented async multithreaded processing with SQL query tuning, reducing processing time by 30%.',
      'Coordinated a four-engineer QA workstream: ran day-to-day delivery while reporting into engineering management.',
    ] },
    { roleKey: '1:Meridian Systems', bullets: [
      'Built billing integrations for B2B SaaS clients, cutting reconciliation effort noticeably.',
      'Maintained the migration from a monolith to modular services with zero data loss.',
    ] },
    { roleKey: '2:Ardent Digital', bullets: [
      'Shipped customer-facing web features in two-week cycles.',
      'Wrote the first automated test suite for the payments module.',
    ] },
  ];
  const handoffTitles = ['Senior Software Engineer', 'Software Engineer', 'Junior Software Engineer'];
  handoffFields.forEach((hf, i) => {
    store.insertArtifact({
      id: randomUUID(), tenantId: tenant.id, candidateId: candidate.id,
      kind: 'handoff_block', title: `Your bullets: ${handoffTitles[i]}`, quarantine: 'clean',
      fields: hf,
      sanitizedText: null, content: hf.bullets.map((b, n) => `${n + 1}. ${b.split(':')[0]}.`).join('\n'),
      injectionAttempts: 0, createdBy: 'system', createdAt: now(),
    });
  });

  /* The revamped CV: every role now has a handoff block, so this mirrors
     exactly what agentCvAssembler writes once a live resume_studio run
     completes the final role. */
  const nadiaResumeFields = parseResume(RESUME_RAW);
  const { content: cvContent, fields: cvFields } = assembleCv(
    candidate.name, nadiaResumeFields, handoffFields.map(hf => ({ fields: hf })));
  store.insertArtifact({
    id: randomUUID(), tenantId: tenant.id, candidateId: candidate.id,
    kind: 'cv', title: 'Revamped CV', quarantine: 'clean',
    fields: cvFields as unknown as Record<string, unknown>, sanitizedText: null, content: cvContent,
    injectionAttempts: 0, createdBy: 'system', createdAt: now(),
  });

  /* Consent before the verified session existed (L4). */
  const consentId = randomUUID();
  store.insertConsent({
    id: consentId, tenantId: tenant.id, candidateId: candidate.id, sessionId: null,
    scope: 'recording and sharing', grantedAt: '2026-09-12T09:14:00.000Z', withdrawnAt: null,
    retentionPolicy: '6 months', createdAt: now(),
  });
  const sessionId = randomUUID();
  const session: InterviewSession = {
    id: sessionId, tenantId: tenant.id, candidateId: candidate.id, flowRunId: null,
    mode: 'verified', status: 'complete', date: '2026-09-12', duration: '14:02',
    star: { S: 18, T: 9, A: 44, R: 29 }, targets: { S: 15, T: 10, A: 50, R: 25 },
    ownership: 61, trailing: 2, transcript: TRANSCRIPT_TURNS, debrief: null,
    consentId, createdAt: now(),
  };
  store.insertSession(session);
  store.db.prepare('UPDATE consents SET session_id = ? WHERE id = ?').run(sessionId, consentId);

  /* The shareable profile page: same completion gate as the CV, written
     by the same agent block once a live resume_studio run finishes the
     final role. Nadia already has a completed verified session above,
     so this is the one seeded profile that can honestly show the
     "verified" badge. */
  const { content: profileContent, fields: profileFields } = assembleProfilePage(
    candidate.name, candidate.targetRole, nadiaResumeFields,
    handoffFields.map(hf => ({ fields: hf })), true);
  store.insertArtifact({
    id: randomUUID(), tenantId: tenant.id, candidateId: candidate.id,
    kind: 'profile_page', title: 'Candidate profile page', quarantine: 'clean',
    /* Seeded as already approved by Nadia, so the demo link works; real
       pages start unshared until the candidate approves (ADR-0022). */
    fields: {
      ...(profileFields as unknown as Record<string, unknown>),
      share: { enabled: true, approvedAt: now(), expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() },
    }, sanitizedText: null, content: profileContent,
    injectionAttempts: 0, createdBy: 'system', createdAt: now(),
  });

  /* One flag of each type, per the demo scenario. */
  const mkFlag = (type: 'claim_missing_from_cv' | 'jd_gap' | 'source_conflict' | 'metric_confirmed',
    status: 'open' | 'actioned' | 'resolved', title: string, body: string, quote: string) => {
    store.insertFlag({
      id: randomUUID(), tenantId: tenant.id, candidateId: candidate.id, type, status,
      title, body, quote, sourceRunId: null, createdAt: now(),
    });
  };
  mkFlag('claim_missing_from_cv', 'open', 'Claim not on CV',
    'Coordinated four engineers on the WCAG automation workstream. No leadership line on the CV.',
    '"I ran the workstream day to day"');
  mkFlag('jd_gap', 'open', 'JD must-have not evidenced',
    'Kubernetes, client JD must-have. No evidence in the CV or the interview.',
    '"I have not, honestly"');
  mkFlag('source_conflict', 'open', 'Source conflict on end date',
    'LinkedIn snapshot end 10/2022 against CV 10/2020. The conservative version (10/2020) is used in outputs until the candidate confirms.',
    'snapshot: 10/2022, cv: 10/2020');
  mkFlag('metric_confirmed', 'actioned', 'Metric confirmed',
    'Processing time reduced by about 30%. Stated twice, matches the CV bullet. Cleared for client-facing use.',
    '"processing time dropped by about 30%"');

  /* Candidate-facing tasks, severity stripped, task phrasing. */
  const mkTask = (type: 'task' | 'warn', source: 'recruiter' | 'system', title: string, body: string) => {
    store.insertTask({
      id: randomUUID(), tenantId: tenant.id, candidateId: candidate.id, type,
      done: false, source, title, body, flagId: null, createdAt: now(),
    });
  };
  mkTask('task', 'recruiter', 'Add the leadership line to your CV',
    'You said you coordinated four engineers on the WCAG workstream. It is not on your CV yet. Your recruiter agrees, it is earned.');
  /* The JD gap and the date conflict stay as open suggestions awaiting
     recruiter approval. Only approved suggestions become candidate tasks. */

  /* Owen Castel: just about to start onboarding. Recruiter-provisioned
     (name, target role and target company already known from the client
     brief) but has not logged in to submit a job description, resume or
     LinkedIn yet, so the onboarding gate is pending from a standing start. */
  const owenUser = store.createUser(tenant.id, 'owen@gennext.demo', pw, 'candidate', 'Owen Castel');
  const owenId = randomUUID();
  store.insertCandidate({
    id: owenId, tenantId: tenant.id, userId: owenUser.id,
    name: 'Owen Castel', targetRole: 'Product Manager, Growth', targetCompany: 'Halden Retail',
    employer: '', tenure: '', cvTenureStart: null, cvTenureEnd: null,
    stage: 'Screening', parked: false, linkedinStatus: 'not linked',
    currentCompensation: null, compExpectations: null, noticePeriod: null, motivation: null,
    createdAt: now(),
  });

  /* Priya Anand: halfway through onboarding. Her job description and
     resume are already in (quarantined below); only her LinkedIn is
     still missing, so the onboarding gate is one step from complete and
     the research step has not fired yet. */
  const priyaUser = store.createUser(tenant.id, 'priya@gennext.demo', pw, 'candidate', 'Priya Anand');
  const priyaCandidate: Candidate = {
    id: randomUUID(), tenantId: tenant.id, userId: priyaUser.id,
    name: 'Priya Anand', targetRole: 'DevOps Engineer, Platform', targetCompany: 'Vector Cloud',
    employer: '', tenure: '', cvTenureStart: null, cvTenureEnd: null,
    stage: 'Screening', parked: false, linkedinStatus: 'not linked',
    currentCompensation: null, compExpectations: null, noticePeriod: null, motivation: null,
    createdAt: now(),
  };
  store.insertCandidate(priyaCandidate);
  quarantine(store, ctx, { candidateId: priyaCandidate.id, kind: 'jd', title: 'Target job description', raw: JD_RAW_PRIYA, createdBy: priyaUser.id });
  quarantine(store, ctx, { candidateId: priyaCandidate.id, kind: 'resume', title: 'Uploaded resume', raw: RESUME_RAW_PRIYA, createdBy: priyaUser.id });

  /* Flow defs and prompt custody. Prompts are global (L3); flow defs are
     per tenant, and the second tenant gets its own copy below. */
  for (const def of FLOW_DEFS) store.upsertFlowDef(tenant.id, def);
  seedPrompts(store);

  /* Entitlements: the demo tenant runs everything. */
  for (const m of ['pipeline', 'screener', 'builder', 'notes', 'journey', 'resume_studio', 'linkedin_studio', 'practice', 'admin', 'billing']) {
    store.setEntitlement(tenant.id, m, true);
  }

  /* Second tenant: runs one module only. Isolation proof (L9, P5 exit). */
  const tenant2 = store.createTenant('Northgate Health');
  for (const def of FLOW_DEFS) store.upsertFlowDef(tenant2.id, def);
  const ctx2 = { tenantId: tenant2.id };
  const ngRecruiter = store.createUser(tenant2.id, 'recruiter@northgate.demo', pw, 'recruiter', 'T. Ellison');
  const ngHr = store.createUser(tenant2.id, 'hr@northgate.demo', pw, 'hr', 'H. Darrow');
  for (const m of ['pipeline', 'screener', 'builder', 'notes', 'journey', 'resume_studio', 'linkedin_studio', 'practice', 'admin', 'billing']) {
    store.setEntitlement(tenant2.id, m, m === 'pipeline');
  }
  store.insertCandidate({
    ...candidate, id: randomUUID(), tenantId: tenant2.id, userId: null,
    name: 'Iris Vale', currentCompensation: null, compExpectations: null,
    noticePeriod: null, motivation: null, createdAt: now(),
  });

  /* Requisitions, applications and approvals for both hiring models. */
  const actor = (u: { id: string; displayName: string; role: string }) => ({ id: u.id, name: u.displayName, role: u.role });
  seedHiring(store, {
    gennext: { ctx, recruiter: actor(recruiter), admin: actor(admin), candidates: { nadia: candidate.id, owen: owenId, priya: priyaCandidate.id } },
    northgate: { ctx: ctx2, recruiter: actor(ngRecruiter), hr: actor(ngHr) },
  });

  store.audit(tenant.id, 'system', 'system', 'seed', `demo:${tr.artifact.id}`);
  store.audit(tenant2.id, 'system', 'system', 'seed', 'isolated-tenant');

  return {
    tenantId: tenant.id, adminId: admin.id, recruiterId: recruiter.id,
    candidateUserId: candUser.id, candidateId: candidate.id, consentId, sessionId,
    tenant2Id: tenant2.id,
  };
}
