/* CV intake (ADR-0024, ADR-0026). One path for every document that becomes
   evidence: the candidate's own upload, a recruiter's upload, a bulk CV
   upload onto a requisition, and the public apply page.

   File -> text (documents.ts) -> quarantine (L1) -> structure (the
   deterministic parser, then the guarded model when it found no roles) ->
   an artifact that records where it came from. Applying with a CV then
   derives who the person is from that text, de-duplicates, attaches the CV
   and scores the application on it, so a bulk-uploaded candidate is ranked
   on evidence, not on a name. */

import type { Store, Ctx } from './db.ts';
import type { Artifact } from './types.ts';
import type { LlmProvider } from './providers/llm.ts';
import { quarantine } from './quarantine.ts';
import { extractDocument, DocumentError } from './documents.ts';
import { structureResumeAssisted } from './model-parse.ts';
import { applyToRequisition, rescoreRequisition, type ApplyResult } from './hiring.ts';
import type { ResumeFields } from './agents.ts';

export interface Uploader { id: string; name: string; role: string }

export type DocKind = 'resume' | 'jd';
const DOC_TITLE: Record<DocKind, string> = { resume: 'CV', jd: 'Job description' };

export interface AttachInput {
  candidateId: string;
  kind: DocKind;
  text: string;
  filename: string;
  source: Record<string, unknown>;
  uploader: Uploader;
  llm?: LlmProvider | null;
}

export interface AttachResult {
  artifact: Artifact;
  fields: Record<string, unknown>;
  events: Array<{ kind: string; detail: string }>;
}

/* Quarantine the text, structure a CV, and record provenance on the
   artifact. Audited as document_uploaded. */
export async function attachDocument(store: Store, ctx: Ctx, input: AttachInput): Promise<AttachResult> {
  const filename = input.filename.replace(/[^\w .()-]/g, '').slice(0, 120);
  const result = quarantine(store, ctx, {
    candidateId: input.candidateId, kind: input.kind,
    title: filename ? `${DOC_TITLE[input.kind]}: ${filename}` : DOC_TITLE[input.kind],
    raw: input.text, createdBy: input.uploader.id,
  });
  let fields = result.artifact.fields;
  if (input.kind === 'resume') {
    const assisted = await structureResumeAssisted(input.llm ?? null, result.artifact.sanitizedText ?? '');
    fields = assisted.by === 'model'
      ? { ...fields, ...assisted.fields, parsedBy: 'model' }
      : { ...fields, parsedBy: 'scripted' };
  }
  fields = {
    ...fields,
    source: { ...input.source, uploadedBy: input.uploader.name, uploadedByRole: input.uploader.role, uploadedAt: result.artifact.createdAt },
  };
  store.updateArtifactFields(ctx, result.artifact.id, fields);
  store.audit(ctx.tenantId, input.uploader.name, input.uploader.role, 'document_uploaded', `${input.kind}:${result.artifact.id}`);
  return { artifact: { ...result.artifact, fields }, fields, events: result.events };
}

/* Who the CV belongs to, read from its own text: the first line that is not
   a contact line or a heading is the name. Contact details come from the
   structured fields. Nothing is guessed; a missing value stays empty. */
export interface CvIdentity {
  name: string; email: string | null; phone: string | null;
  /* The current (latest) role: its company, display tenure, and the
     conservative start and end the conflict detector compares with
     LinkedIn. Total experience is computed from all roles in scoring. */
  employer: string; tenure: string; latestStart: string | null; latestEnd: string | null;
}

export function identityFromCv(text: string, fields: Partial<ResumeFields>): CvIdentity {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const isContact = (l: string) => /@|\+?\d[\d\s().-]{7,}\d|https?:\/\/|linkedin|github|\|/i.test(l);
  const isHeading = (l: string) => /^(curriculum vitae|resume|cv|summary|profile|experience|education|skills)$/i.test(l);
  const name = (lines.find(l => !isContact(l) && !isHeading(l) && l.length <= 60 && /[a-z]/i.test(l)) ?? '')
    .split(/\s{2,}/)[0]!.trim();
  const roles = fields.roles ?? [];
  const latest = roles[0];
  const toMonth = (d: string | undefined): string | null => {
    if (!d) return null;
    if (/^\d{2}\/\d{4}$/.test(d)) return d;
    if (/^\d{4}$/.test(d)) return `01/${d}`;
    return null;
  };
  return {
    name,
    email: fields.email?.trim() || null,
    phone: fields.phone?.trim() || null,
    employer: latest?.company ?? '',
    tenure: latest ? `${latest.start} - ${latest.end}` : '',
    latestStart: latest ? toMonth(latest.start) : null,
    latestEnd: latest ? (/^present$/i.test(latest.end) ? null : toMonth(latest.end)) : null,
  };
}

export interface CvApplyInput {
  requisitionId: string;
  bytes: Uint8Array;
  filename: string;
  source: 'bulk' | 'apply_page' | 'recruiter';
  answers?: Record<string, string>;
  /* Apply-page fields override what the CV says about contact details. */
  name?: string; email?: string | null; phone?: string | null;
  uploader: Uploader;
  llm?: LlmProvider | null;
}

export interface CvApplyResult extends ApplyResult {
  name: string;
  created: boolean;
  rolesRead: number;
  parsedBy: 'model' | 'scripted';
}

export class IntakeError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/* Read, de-duplicate, attach, score. A CV that cannot be read is refused
   before any candidate is created, so a bad file never leaves a shell
   record behind. */
export async function applyWithCv(store: Store, ctx: Ctx, input: CvApplyInput): Promise<CvApplyResult> {
  let doc;
  try { doc = await extractDocument(input.bytes); }
  catch (e) { throw new IntakeError(e instanceof DocumentError ? e.code : 'unreadable_document'); }

  /* Structure once up front to learn who this is; the attached artifact is
     structured again inside quarantine, identically (deterministic). */
  const preview = await structureResumeAssisted(input.llm ?? null, doc.text);
  const id = identityFromCv(doc.text, preview.fields);
  const name = (input.name ?? '').trim() || id.name;
  if (!name) throw new IntakeError('name_not_found');

  const before = store.candidates(ctx).length;
  const applied = applyToRequisition(store, ctx, input.uploader, {
    requisitionId: input.requisitionId, name,
    email: input.email ?? id.email, phone: input.phone ?? id.phone,
    employer: id.employer, source: input.source, answers: input.answers ?? {}, cvHash: doc.sha256,
  });
  const created = store.candidates(ctx).length > before;

  /* Attach the CV unless this exact file is already on the candidate. */
  const has = store.artifacts(ctx, applied.candidateId, 'resume')
    .some(a => (a.fields as { source?: { sha256?: string } }).source?.sha256 === doc.sha256);
  let parsedBy: 'model' | 'scripted' = preview.by;
  if (!has) {
    const att = await attachDocument(store, ctx, {
      candidateId: applied.candidateId, kind: 'resume', text: doc.text, filename: input.filename,
      source: { filename: input.filename || 'CV', format: doc.format, parser: doc.parser, pages: doc.pages, bytes: doc.bytes, sha256: doc.sha256 },
      uploader: input.uploader, llm: input.llm,
    });
    parsedBy = (att.fields.parsedBy as 'model' | 'scripted') ?? parsedBy;
    if (created) {
      store.updateCandidate(ctx, applied.candidateId, {
        employer: id.employer, tenure: id.tenure,
        cvTenureStart: id.latestStart, cvTenureEnd: id.latestEnd,
      });
    }
    /* The application was scored before its evidence existed; score it
       again now that the CV is attached. Overrides survive a re-score. */
    rescoreRequisition(store, ctx, input.requisitionId);
  }
  const application = store.application(ctx, applied.application.id) ?? applied.application;
  return { ...applied, application, name, created, rolesRead: preview.fields.roles.length, parsedBy };
}
