/* Certainty spine types. Master build prompt, section 5. */

export type Role = 'admin' | 'recruiter' | 'candidate';

export type Stage = 'Screening' | 'Submission draft' | 'With client' | 'Interview' | 'Offer';
export const STAGES: Stage[] = ['Screening', 'Submission draft', 'With client', 'Interview', 'Offer'];

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
