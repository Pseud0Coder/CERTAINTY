/* Certainty spine types. Master build prompt, section 5. */

/* `hr`: HR or hiring management. Approves requisitions and offers, sees
   every pipeline and the reports (ADR-0024). */
export type Role = 'admin' | 'recruiter' | 'hr' | 'candidate';

/* Stage sets come from the tenant's hiring model (ADR-0024). A stage is a
   string checked against the tenant's set; STAGES stays the agency set. */
export type HiringModel = 'agency' | 'in_house';
export const STAGE_SETS: Record<HiringModel, string[]> = {
  agency: ['Screening', 'Submission draft', 'With client', 'Interview', 'Offer', 'Placed'],
  in_house: ['Applied', 'Screening', 'Assessment', 'Interview', 'Offer', 'Hired'],
};
export type Stage = string;
export const STAGES: Stage[] = STAGE_SETS.agency;

export interface TenantSettings {
  hiringModel: HiringModel;
  timezone: string;
  /* Default candidate communication locale (ADR-0024). A message may
     override it per send. */
  locale: MessageLocale;
}
export const DEFAULT_TENANT_SETTINGS: TenantSettings = { hiringModel: 'agency', timezone: 'UTC', locale: 'en' };

export type SessionMode = 'practice' | 'verified';
export type SessionStatus = 'active' | 'complete' | 'stopped';

export type FlagType = 'claim_missing_from_cv' | 'jd_gap' | 'source_conflict' | 'metric_confirmed';
export type FlagStatus = 'open' | 'actioned' | 'resolved';

export type ArtifactKind =
  | 'resume' | 'transcript' | 'linkedin_snapshot' | 'linkedin_link' | 'jd'
  | 'submission_doc' | 'client_email' | 'recruiter_notes' | 'handoff_block' | 'debrief'
  | 'research_report' | 'cv' | 'profile_page' | 'profile_picture'
  /* Saved LinkedIn Studio output, and connected portfolio accounts (ADR-0022). */
  | 'linkedin_sections' | 'connector_link' | 'connector_snapshot';

export type FindingKind = 'good' | 'improve' | 'needs_work';

export interface ResearchFinding {
  kind: FindingKind;
  title: string;
  detail: string;
}

export type QuarantineStatus = 'clean' | 'sanitized' | 'rejected';

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  role: Role;
  displayName: string;
  createdAt: string;
  /* Set when someone else chose the password (a recruiter adding a
     candidate). The user must replace it before using the app. */
  mustChangePassword?: boolean;
}

export interface Candidate {
  id: string;
  tenantId: string;
  userId: string | null;      // linked candidate user account
  name: string;
  targetRole: string;
  targetCompany: string | null;   // set during candidate onboarding
  employer: string;
  tenure: string;             // display string, MM/YYYY where known
  cvTenureStart: string | null; // structured conservative dates, spine truth
  cvTenureEnd: string | null;
  stage: Stage;
  parked: boolean;
  linkedinStatus: string;
  /* Contact and origin, for candidates without a login (bulk upload, the
     apply page). Internal; never projected to other candidates. */
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  // Internal fields (L2): never in candidate projections.
  currentCompensation: string | null;
  compExpectations: string | null;
  noticePeriod: string | null;
  motivation: string | null;
  createdAt: string;
}

export interface ConsentRecord {
  id: string;
  tenantId: string;
  candidateId: string;
  sessionId: string | null;
  scope: string;
  grantedAt: string | null;
  withdrawnAt: string | null;
  retentionPolicy: string;
  createdAt: string;
}

export interface TranscriptTurn {
  t: string;                  // timecode MM:SS
  who: string;
  text: string;
  annot?: { mark: string; label: string };
}

export interface StarMetrics {
  S: number; T: number; A: number; R: number;
}

export interface InterviewSession {
  id: string;
  tenantId: string;
  candidateId: string;
  flowRunId: string | null;
  mode: SessionMode;
  status: SessionStatus;
  date: string;
  duration: string;
  star: StarMetrics | null;
  targets: StarMetrics;
  ownership: number | null;   // percent first person
  trailing: number | null;
  transcript: TranscriptTurn[];
  debrief: string | null;     // text block deliverable
  consentId: string | null;
  createdAt: string;
}

export interface Flag {
  id: string;
  tenantId: string;
  candidateId: string;
  type: FlagType;
  status: FlagStatus;
  title: string;
  body: string;
  quote: string;
  sourceRunId: string | null;
  createdAt: string;
}

export interface Artifact {
  id: string;
  tenantId: string;
  candidateId: string;
  kind: ArtifactKind;
  title: string;
  quarantine: QuarantineStatus;
  // Structured fields produced by the quarantine pipeline (L1).
  fields: Record<string, unknown>;
  // Sanitized text. Raw ingested text is never stored past the pipeline.
  sanitizedText: string | null;
  content: string | null;     // generated deliverable content
  injectionAttempts: number;
  createdBy: string;          // user id or 'system'
  createdAt: string;
}

export interface CandidateTask {
  id: string;
  tenantId: string;
  candidateId: string;
  type: 'task' | 'warn';
  done: boolean;
  source: 'recruiter' | 'system';
  title: string;
  body: string;
  flagId: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  actor: string;
  role: Role | 'system';
  action: string;
  target: string;
  ts: string;
}

export type FlowId = 'submission_builder' | 'interview_screener' | 'resume_studio' | 'linkedin_studio' | 'research';

export interface FlowStepDef {
  id: string;
  kind: 'agent' | 'human_gate' | 'auto';
  agent?: string;             // agent name in the custody registry
  tools?: string[];           // tool allowlist for this step
  modelTier?: 'cheap' | 'strong';
  outputSchema?: string;      // contract name (A7)
  interactive?: boolean;      // session agent step: accepts turns
  completeWhen?: string;      // completion declaration validator (A5)
  description: string;
}

export interface FlowDef {
  id: FlowId;
  version: number;
  title: string;
  steps: FlowStepDef[];
  enabled: boolean;
}

export type FlowRunStatus = 'running' | 'awaiting_human' | 'complete' | 'failed';

export interface TraceEntry {
  seq: number;
  step: string;
  tool: string | null;
  input: unknown;
  output: unknown;
  model: string;
  latencyMs: number;
  costUsd: number;
  ts: string;
}

export interface FlowRun {
  id: string;
  tenantId: string;
  flowId: FlowId;
  flowVersion: number;
  candidateId: string;
  actorRole: Role;
  status: FlowRunStatus;
  currentStep: string | null;
  stepStates: Record<string, string>;
  retries: Record<string, number>;
  error: string | null;
  trace: TraceEntry[];
  toolCalls: Record<string, boolean>;  // idempotency keys
  createdAt: string;
}

export interface ModuleEntitlement {
  tenantId: string;
  module: string;
  enabled: boolean;
}

export interface UsageMeter {
  id: string;
  tenantId: string;
  kind: 'voice_minutes' | 'generations' | 'stt_seconds' | 'llm_tokens';
  quantity: number;
  refId: string;
  ts: string;
}

export interface QuarantineEvent {
  id: string;
  tenantId: string;
  artifactId: string;
  kind: 'stripped_instruction' | 'injection_attempt' | 'rejected';
  detail: string;
  ts: string;
}

/* Role projections (L2). These are the only shapes the API may return. */
export interface CandidatePublic {
  id: string;
  name: string;
  targetRole: string;
  targetCompany: string | null;   // set during candidate onboarding
  employer: string;
  tenure: string;
  stage: Stage;
  parked: boolean;
  linkedinStatus: string;
}

export type CandidateRoleView = CandidatePublic & {
  tasks: CandidateTask[];
  sessions: PublicSessionView[];
  artifacts: PublicArtifactView[];
};

export interface PublicSessionView {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  date: string;
  duration: string;
  star: StarMetrics | null;
  ownership: number | null;
  transcript: TranscriptTurn[];
  debrief: string | null;
}

export interface PublicArtifactView {
  id: string;
  kind: ArtifactKind;
  title: string;
  createdAt: string;
  content: string | null;
}

/* ---------------------------------------------------------------------- */
/* Requisitions and applications (ADR-0024)                                 */

export type RequisitionStatus = 'draft' | 'pending_approval' | 'open' | 'closed' | 'rejected';

export interface MustHave {
  id: string;
  label: string;
  weight: number;       // 1 to 3
  required: boolean;    // a gap knocks the application out
}

export interface RequisitionCriteria {
  mustHaves: MustHave[];
  minYears: number | null;
  locations: string[];
  remoteOk: boolean;
  workAuthRequired: boolean;
}

export interface ApprovalEntry {
  action: 'submitted' | 'approved' | 'rejected' | 'changes_requested' | 'closed' | 'reopened';
  by: string;            // user id
  byName: string;        // display name, for the history the UI renders
  role: string;
  comment: string;
  at: string;
}

export interface Requisition {
  id: string;
  tenantId: string;
  title: string;
  department: string;
  location: string;
  client: string | null;          // agency only: the hiring client
  headcount: number;
  salaryMin: number | null;       // internal
  salaryMax: number | null;       // internal
  currency: string;
  description: string;            // the JD
  status: RequisitionStatus;
  criteria: RequisitionCriteria;
  shortlistAt: number | null;     // progression: score at or above shortlists
  approvals: ApprovalEntry[];
  createdBy: string;              // user id
  createdAt: string;
  updatedAt: string;
}

export type ApplicationStatus = 'new' | 'screened' | 'shortlisted' | 'knocked_out' | 'rejected' | 'withdrawn' | 'hired';
export type ApplicationSource = 'recruiter' | 'bulk' | 'apply_page' | 'seed';
export type EvidenceStatus = 'verified' | 'claimed' | 'partial' | 'gap';

export interface ScoreComponent {
  mustHaveId: string;
  label: string;
  weight: number;
  required: boolean;
  status: EvidenceStatus;
  strength: number;     // 1, 0.7, 0.35, 0
  points: number;       // contribution to the 0 to 100 total
  maxPoints: number;
  sources: string[];
}

export interface KnockoutResult {
  rule: 'required_must_have' | 'min_years' | 'location' | 'work_authorization';
  label: string;
  outcome: 'knocked_out' | 'pass' | 'check';
  reason: string;
}

export interface ApplicationScore {
  total: number;                 // 0 to 100, before any override adjustment
  components: ScoreComponent[];
  knockouts: KnockoutResult[];
  years: number | null;
  computedAt: string;
}

export interface ApplicationOverride {
  kind: 'adjust' | 'include' | 'exclude';
  delta: number;                 // adjust only
  reason: string;
  by: string;
  role: string;
  at: string;
}

export interface Application {
  id: string;
  tenantId: string;
  requisitionId: string;
  candidateId: string;
  stage: Stage;
  status: ApplicationStatus;
  source: ApplicationSource;
  primary: boolean;
  answers: Record<string, string>;
  score: ApplicationScore | null;
  override: ApplicationOverride | null;
  dedup: { reason: string } | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------------- */
/* Offers (ADR-0024)                                                       */

export type OfferStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'accepted' | 'declined' | 'rejected' | 'withdrawn';

export interface OfferTerms {
  salary: number | null;   // internal until the letter is sent
  currency: string;
  startDate: string;       // YYYY-MM-DD
  location: string;
  notes: string;
}

/* A version is frozen once written: editing an offer appends a new version,
   so the offer's history and the candidate-facing letter never drift. */
export interface OfferVersion {
  version: number;
  terms: OfferTerms;
  letter: string;
  createdBy: string;
  createdAt: string;
}

export interface OfferApproval {
  action: 'submitted' | 'approved' | 'rejected' | 'changes_requested';
  by: string;
  byName: string;
  role: string;
  comment: string;
  at: string;
}

export interface Offer {
  id: string;
  tenantId: string;
  requisitionId: string;
  applicationId: string;
  candidateId: string;
  status: OfferStatus;
  versions: OfferVersion[];      // latest is current
  approvals: OfferApproval[];
  decidedAt: string | null;
  decisionNote: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------------- */
/* Communications (ADR-0024)                                               */

export type MessageChannel = 'email' | 'sms' | 'whatsapp';
export type MessageLocale = 'en' | 'ar';
export type MessageDirection = 'out' | 'in';
export type MessageStatus = 'queued' | 'sent' | 'failed' | 'received' | 'escalated';

/* Every automated candidate communication is a stored message, never a
   side effect of a flow. The locale decides the rendered subject and body;
   an inbound reply that needs a human flips to `escalated`. */
export interface Message {
  id: string;
  tenantId: string;
  candidateId: string;
  applicationId: string | null;
  channel: MessageChannel;
  direction: MessageDirection;
  locale: MessageLocale;
  template: string | null;
  subject: string;
  body: string;
  status: MessageStatus;
  providerId: string | null;
  error: string | null;
  escalationReason: string | null;
  createdAt: string;
  sentAt: string | null;
}

/* ---------------------------------------------------------------------- */
/* Scheduling (ADR-0024)                                                   */

export type MeetingKind = 'screening' | 'interview' | 'assessment';
export type MeetingStatus = 'proposed' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';

export interface MeetingChange {
  action: 'created' | 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';
  at: string;
  by: string;
  note: string;
}

export interface Meeting {
  id: string;
  tenantId: string;
  applicationId: string | null;
  candidateId: string;
  requisitionId: string | null;
  kind: MeetingKind;
  startsAt: string;      // ISO datetime
  endsAt: string;        // ISO datetime
  timezone: string;
  location: string;
  status: MeetingStatus;
  calendarEventId: string | null;   // set when a calendar provider accepts it
  history: MeetingChange[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/* ---------------------------------------------------------------------- */
/* Assessments (ADR-0024)                                                  */

export type AssessmentKind = 'technical' | 'coding' | 'psychometric';
export type QuestionType = 'mcq' | 'text' | 'code';
export type AttemptStatus = 'invited' | 'in_progress' | 'submitted' | 'scored';

export interface AssessmentQuestion {
  id: string;
  prompt: string;
  type: QuestionType;
  options: string[];       // mcq only
  correct: string | null;  // mcq only
  points: number;
  competency: string;
  rubric: string[];        // text and code: terms the answer must cover
}

export interface Assessment {
  id: string;
  tenantId: string;
  requisitionId: string | null;
  title: string;
  kind: AssessmentKind;
  questions: AssessmentQuestion[];
  passScore: number;
  durationMinutes: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionScore {
  questionId: string;
  points: number;
  maxPoints: number;
  basis: string;
}

export interface AnomalyFlag {
  type: 'fast_completion' | 'straightlining' | 'impossible_speed' | 'duplicate_attempt' | 'outlier';
  detail: string;
}

export interface AssessmentScore {
  raw: number;              // 0 to 100 before normalization
  normalized: number | null; // 0 to 100 across the cohort, set on rescore
  questions: QuestionScore[];
  flags: AnomalyFlag[];
  scoredAt: string;
}

export interface AssessmentAttempt {
  id: string;
  tenantId: string;
  assessmentId: string;
  candidateId: string;
  applicationId: string | null;
  status: AttemptStatus;
  answers: Record<string, string>;
  startedAt: string | null;
  submittedAt: string | null;
  durationMinutes: number | null;
  score: AssessmentScore | null;
  createdAt: string;
  updatedAt: string;
}
