/* Hiring demo seed (ADR-0024, ADR-0026). Fictional, self-consistent, and
   built only through the service functions, so every record carries the
   same audit trail, scoring and rules a live run would produce.

   Gennext (agency): each journey candidate applies to the client role they
   are already targeting, and a fourth client role waits on the admin.
   Northgate (in-house): HR approves, six applicants with text CVs are
   scored and ranked on evidence (two pass, three are knocked out for three
   different reasons, one sits below the shortlist line), the leader has an
   offer waiting on HR, and a second requisition waits for approval. */
import { createHash } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import { quarantine } from './quarantine.ts';
import {
  createRequisition, submitRequisition, decideRequisition, applyToRequisition, rescoreRequisition,
  type Actor, type RequisitionInput,
} from './hiring.ts';
import { advanceApplication } from './stages.ts';
import { createOffer, submitOffer } from './offers.ts';
import { identityFromCv } from './intake.ts';

export interface HiringSeedInput {
  gennext: { ctx: Ctx; recruiter: Actor; admin: Actor; candidates: { nadia: string; owen: string; priya: string } };
  northgate: { ctx: Ctx; recruiter: Actor; hr: Actor };
}

/* Draft, submit, approve: the same three steps a person takes. */
function openRequisition(store: Store, ctx: Ctx, author: Actor, approver: Actor, input: RequisitionInput, comment: string): string {
  const r = createRequisition(store, ctx, author, input);
  submitRequisition(store, ctx, author, r.id);
  decideRequisition(store, ctx, approver, r.id, 'approved', comment);
  return r.id;
}

function pendingRequisition(store: Store, ctx: Ctx, author: Actor, input: RequisitionInput): string {
  const r = createRequisition(store, ctx, author, input);
  submitRequisition(store, ctx, author, r.id);
  return r.id;
}

/* Applicant CVs for the Northgate data role, in the plain layout the
   deterministic parser reads. Every figure is fictional. */
interface Applicant { email: string; phone: string; source: 'bulk' | 'apply_page' | 'recruiter'; workAuthorized: 'yes' | 'no'; cv: string }

const APPLICANTS: Applicant[] = [
  {
    email: 'layla.haddad@example.com', phone: '+971 50 555 0141', source: 'bulk', workAuthorized: 'yes', cv: `Layla Haddad
Senior Data Engineer
Dubai, UAE | +971 50 555 0141 | layla.haddad@example.com
SKILLS
Engineering: Python data pipelines | Kafka streaming | SQL tuning | Airflow orchestration
EDUCATION
BSc Computer Science, American University of Sharjah, 2016
EXPERIENCE
Meridian Payments | Senior Data Engineer | 04/2021 - Present | single
- Built Python data pipelines on Kafka streaming that settle 2 million card events a day.
- Cut the nightly reconciliation query from 40 minutes to 6 through SQL tuning and partitioning.
Oasis Retail Group | Data Engineer | 07/2016 - 03/2021 | single
- Moved 30 batch jobs to Airflow orchestration with alerting on every failed run.`,
  },
  {
    email: 'marcus.bell@example.com', phone: '+971 52 555 0177', source: 'apply_page', workAuthorized: 'yes', cv: `Marcus Bell
Data Engineer
Abu Dhabi, UAE | +971 52 555 0177 | marcus.bell@example.com
SKILLS
Engineering: Python data pipelines | Kafka streaming | SQL tuning
EDUCATION
MSc Data Science, Khalifa University, 2019
EXPERIENCE
Falcon Logistics | Data Engineer | 09/2019 - Present | single
- Wrote Python data pipelines that feed Kafka streaming topics for 400 delivery vans.
- Reduced warehouse dashboard load time by half through SQL tuning on the reporting schema.`,
  },
  {
    email: 'tomas.lindqvist@example.com', phone: '+971 55 555 0123', source: 'bulk', workAuthorized: 'yes', cv: `Tomas Lindqvist
Backend Engineer
Dubai, UAE | +971 55 555 0123 | tomas.lindqvist@example.com
SKILLS
Engineering: Python services | Kafka consumers | Postgres
EDUCATION
BSc Software Engineering, KTH Royal Institute of Technology, 2017
EXPERIENCE
Northwind Travel | Backend Engineer | 02/2018 - Present | single
- Maintained Python services and Kafka consumers for the booking platform.
- Supported a Postgres upgrade across 12 services.`,
  },
  {
    email: 'sofia.marin@example.com', phone: '+971 50 555 0190', source: 'bulk', workAuthorized: 'yes', cv: `Sofia Marin
Analytics Engineer
Dubai, UAE | +971 50 555 0190 | sofia.marin@example.com
SKILLS
Engineering: Python data pipelines | SQL tuning | Airflow orchestration
EDUCATION
BSc Mathematics, University of Barcelona, 2017
EXPERIENCE
Crescent Health | Analytics Engineer | 05/2018 - Present | single
- Built Python data pipelines and Airflow orchestration for 25 clinical reporting jobs.
- Rewrote the claims mart with SQL tuning, cutting refresh time from 3 hours to 35 minutes.`,
  },
  {
    email: 'daniel.kwame@example.com', phone: '+971 56 555 0162', source: 'recruiter', workAuthorized: 'yes', cv: `Daniel Kwame
Data Engineer
Sharjah, UAE | +971 56 555 0162 | daniel.kwame@example.com
SKILLS
Engineering: Python data pipelines | Kafka streaming | SQL tuning
EDUCATION
BSc Computer Engineering, University of Ghana, 2022
EXPERIENCE
Gulfline Telecom | Data Engineer | 08/2023 - Present | single
- Built Python data pipelines on Kafka streaming for 3 network monitoring feeds.
- Used SQL tuning to bring a daily usage report under 10 minutes.`,
  },
  {
    email: 'hana.sato@example.com', phone: '+81 90 5555 0108', source: 'apply_page', workAuthorized: 'no', cv: `Hana Sato
Senior Data Engineer
Osaka, Japan | +81 90 5555 0108 | hana.sato@example.com
SKILLS
Engineering: Python data pipelines | Kafka streaming | SQL tuning | Airflow orchestration
EDUCATION
BEng Information Engineering, Osaka University, 2015
EXPERIENCE
Kansai Rail Systems | Senior Data Engineer | 04/2019 - Present | single
- Led Python data pipelines and Kafka streaming for ticketing across 80 stations.
- Ran Airflow orchestration for 50 daily jobs and SQL tuning on the fares warehouse.
Hoshi Analytics | Data Engineer | 04/2015 - 03/2019 | single
- Built the first SQL warehouse for 6 retail clients.`,
  },
];

export function seedHiring(store: Store, input: HiringSeedInput): void {
  /* Gennext, agency: client roles, approved by the admin. */
  const g = input.gennext;
  const fintech = openRequisition(store, g.ctx, g.recruiter, g.admin, {
    title: 'Senior Software Engineer, FinTech', department: 'Platform', location: 'London', client: 'Ledgerline',
    headcount: 1, salaryMin: 75000, salaryMax: 85000, currency: 'GBP',
    description: 'Ledgerline is hiring a senior engineer for the payments platform team.',
    criteria: {
      mustHaves: [
        { id: 'm0', label: 'Kubernetes production experience', weight: 2, required: false },
        { id: 'm1', label: 'REST API design at scale', weight: 3, required: false },
        { id: 'm2', label: 'SQL optimization for high-volume systems', weight: 2, required: false },
      ],
      minYears: 4, remoteOk: true,
    },
    shortlistAt: 60,
  }, 'Client brief signed.');
  const growth = openRequisition(store, g.ctx, g.recruiter, g.admin, {
    title: 'Product Manager, Growth', department: 'Product', location: 'Manchester', client: 'Halden Retail',
    headcount: 1, salaryMin: 60000, salaryMax: 70000, currency: 'GBP',
    description: 'Halden Retail needs a product manager to own the growth funnel.',
    criteria: { mustHaves: [{ id: 'm0', label: 'Experimentation and A/B testing', weight: 2, required: false }, { id: 'm1', label: 'Funnel analytics', weight: 1, required: false }] },
  }, 'Client brief signed.');
  const devops = openRequisition(store, g.ctx, g.recruiter, g.admin, {
    title: 'DevOps Engineer, Platform', department: 'Platform', location: 'Manchester', client: 'Vector Cloud',
    headcount: 1, salaryMin: 55000, salaryMax: 65000, currency: 'GBP',
    description: 'Vector Cloud is growing its platform team.',
    criteria: {
      mustHaves: [
        { id: 'm0', label: 'Kubernetes in production', weight: 2, required: false },
        { id: 'm1', label: 'Infrastructure as code experience', weight: 2, required: false },
        { id: 'm2', label: 'On-call leadership experience', weight: 1, required: false },
      ],
    },
  }, 'Client brief signed.');
  for (const [reqId, candidateId] of [[fintech, g.candidates.nadia], [growth, g.candidates.owen], [devops, g.candidates.priya]] as const) {
    applyToRequisition(store, g.ctx, g.recruiter, { requisitionId: reqId, candidateId, source: 'recruiter' });
  }
  pendingRequisition(store, g.ctx, g.recruiter, {
    title: 'Data Analyst, Risk', department: 'Risk', location: 'London', client: 'Ledgerline',
    headcount: 2, salaryMin: 45000, salaryMax: 52000, currency: 'GBP',
    description: 'Two analysts for the Ledgerline risk team.',
    criteria: { mustHaves: [{ id: 'm0', label: 'SQL', weight: 2, required: true }, { id: 'm1', label: 'Credit risk reporting', weight: 1, required: false }] },
  });

  /* Northgate, in-house: HR approves; applicants arrive with CVs. */
  const n = input.northgate;
  store.setTenantSettings(n.ctx, { hiringModel: 'in_house', timezone: 'Asia/Dubai' });
  const data = openRequisition(store, n.ctx, n.recruiter, n.hr, {
    title: 'Senior Data Engineer', department: 'Data Platform', location: 'Dubai',
    headcount: 1, salaryMin: 300000, salaryMax: 380000, currency: 'AED',
    description: 'Own the streaming pipelines behind patient scheduling and billing. Hybrid, three days a week in the Dubai office.',
    criteria: {
      mustHaves: [
        { id: 'm0', label: 'Python data pipelines', weight: 3, required: true },
        { id: 'm1', label: 'Kafka streaming', weight: 2, required: true },
        { id: 'm2', label: 'SQL tuning', weight: 2, required: false },
        { id: 'm3', label: 'Airflow orchestration', weight: 1, required: false },
      ],
      minYears: 4, workAuthRequired: true,
    },
    shortlistAt: 70,
  }, 'Budgeted in the FY27 plan.');

  const appIds: Record<string, string> = {};
  for (const a of APPLICANTS) {
    const id = identityFromCv(a.cv, {});
    const applied = applyToRequisition(store, n.ctx, n.recruiter, {
      requisitionId: data, name: id.name, email: a.email, phone: a.phone, source: a.source,
      answers: { workAuthorized: a.workAuthorized },
    });
    const filename = `${id.name.replace(/\s+/g, '-').toLowerCase()}.pdf`;
    const art = quarantine(store, n.ctx, { candidateId: applied.candidateId, kind: 'resume', title: `CV: ${filename}`, raw: a.cv, createdBy: n.recruiter.id });
    const sha256 = createHash('sha256').update(a.cv).digest('hex');
    store.updateArtifactFields(n.ctx, art.artifact.id, {
      ...art.artifact.fields, parsedBy: 'scripted',
      source: { filename, format: 'pdf', parser: 'seed', pages: 1, bytes: a.cv.length, sha256, uploadedBy: n.recruiter.name, uploadedByRole: n.recruiter.role, uploadedAt: art.artifact.createdAt },
    });
    const parsed = identityFromCv(a.cv, art.artifact.fields as never);
    store.updateCandidate(n.ctx, applied.candidateId, {
      employer: parsed.employer, tenure: parsed.tenure, cvTenureStart: parsed.latestStart, cvTenureEnd: parsed.latestEnd,
    });
    appIds[a.email] = applied.application.id;
  }
  rescoreRequisition(store, n.ctx, data);

  /* The leader has interviewed and has an offer waiting on HR; the runner-up
     is at interview. Every move is a stage_advance audit event. */
  const leader = appIds['layla.haddad@example.com']!;
  for (let i = 0; i < 4; i++) advanceApplication(n.ctx, store, leader, n.recruiter.name, n.recruiter.role);
  for (let i = 0; i < 3; i++) advanceApplication(n.ctx, store, appIds['marcus.bell@example.com']!, n.recruiter.name, n.recruiter.role);
  const offer = createOffer(store, n.ctx, n.recruiter, leader, {
    salary: 360000, currency: 'AED', startDate: '2026-12-01', location: 'Dubai', notes: 'Hybrid, three office days a week.',
  });
  submitOffer(store, n.ctx, n.recruiter, offer.id);

  pendingRequisition(store, n.ctx, n.recruiter, {
    title: 'Analytics Engineer', department: 'Data Platform', location: 'Dubai',
    headcount: 1, salaryMin: 220000, salaryMax: 280000, currency: 'AED',
    description: 'Model the scheduling and billing marts for the operations team.',
    criteria: { mustHaves: [{ id: 'm0', label: 'SQL tuning', weight: 2, required: true }, { id: 'm1', label: 'dbt modelling', weight: 2, required: false }], minYears: 2, workAuthRequired: true },
  });
}
