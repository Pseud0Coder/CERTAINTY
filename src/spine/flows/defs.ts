/* Flow definitions, ported from reference-flows.md (master prompt section 10).
   Versioned. Deployed server-side. Seeded per tenant at boot. */
import type { FlowDef } from '../types.ts';

export const FLOW_DEFS: FlowDef[] = [
  {
    id: 'research', version: 1, title: 'Research', enabled: true,
    steps: [
      { id: 'analyse', kind: 'agent', agent: 'research_analyst', tools: ['read_spine', 'write_artifact'], modelTier: 'strong', outputSchema: 'research_report', description: 'Company and JD against the CV: good, improve, needs work' },
    ],
  },
  {
    id: 'submission_builder', version: 1, title: 'Submission Builder', enabled: true,
    steps: [
      { id: 'intake', kind: 'auto', description: 'Intake check against required sources' },
      { id: 'verify', kind: 'agent', agent: 'conflict_detector', tools: ['read_spine', 'write_flag'], modelTier: 'cheap', outputSchema: 'verification', description: 'Cross-source verification of every title and date' },
      { id: 'compose', kind: 'agent', agent: 'submission_composer', tools: ['read_spine', 'write_artifact'], modelTier: 'strong', outputSchema: 'submission_deliverable', description: 'Deliverables plus the deterministic QA checklist, gated 4 of 4 sources' },
      { id: 'deliver', kind: 'human_gate', description: 'Recruiter reviews and shares' },
    ],
  },
  {
    id: 'interview_screener', version: 1, title: 'Interview Screener', enabled: true,
    steps: [
      { id: 'consent', kind: 'human_gate', description: 'Consent record before any verified capture (L4)' },
      { id: 'open_session', kind: 'auto', description: 'Create the verified session linked to the consent record' },
      { id: 'interview', kind: 'agent', agent: 'screener_interviewer', tools: ['read_spine', 'append_transcript'], modelTier: 'strong', interactive: true, description: '8 to 12 competency questions, STAR 15/10/50/25, one follow-up max' },
      { id: 'evaluate', kind: 'agent', agent: 'session_evaluator', tools: ['read_spine', 'write_metrics', 'annotate_transcript', 'write_flag'], modelTier: 'strong', outputSchema: 'session_metrics', description: 'STAR metrics, ownership, trailing counts, annotations, flags' },
      { id: 'suggest', kind: 'agent', agent: 'stage_advisor', tools: ['read_spine', 'suggest_stage'], modelTier: 'cheap', description: 'Stage suggestion. Never advances a stage' },
    ],
  },
  {
    id: 'resume_studio', version: 1, title: 'Resume Studio', enabled: true,
    steps: [
      { id: 'open_session', kind: 'auto', description: 'One role per session, fresh session, practice mode' },
      { id: 'interview', kind: 'agent', agent: 'resume_interviewer', tools: ['read_spine', 'append_transcript'], modelTier: 'cheap', interactive: true, description: 'Era-based depth probing until owned, action, outcome exist', completeWhen: 'era_bullet_count' },
      { id: 'handoff', kind: 'agent', agent: 'resume_handoff', tools: ['read_spine', 'write_artifact'], modelTier: 'cheap', outputSchema: 'handoff_block', description: 'Handoff as a text block with bold lead phrases, never spoken' },
    ],
  },
  {
    id: 'linkedin_studio', version: 1, title: 'LinkedIn Studio', enabled: true,
    steps: [
      { id: 'generate', kind: 'agent', agent: 'linkedin_writer', tools: ['read_spine'], modelTier: 'cheap', interactive: true, description: 'Six sections, one at a time, resume is the source of truth', completeWhen: 'six_sections' },
    ],
  },
];

/* Interactive (session) flows: one active run per candidate per flow,
   enforced here at the runtime layer, not the prompt (Addendum A1). */
export const INTERACTIVE_FLOWS = new Set(['interview_screener', 'resume_studio', 'linkedin_studio']);
