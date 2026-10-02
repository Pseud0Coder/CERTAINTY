/* Quarantine pipeline (L1). Ingested documents are data, never instructions.
   Every upload passes: extract, sanitize, structure. The raw text of an
   ingested document never enters a model context window: only structured
   fields and the sanitized text ever leave this module, and injection
   attempts are logged, flagged, and never executed. */
import { randomUUID } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import type { Artifact, ArtifactKind, QuarantineStatus } from './types.ts';
import { structureResume } from './agents.ts';

interface Rule { name: string; re: RegExp; attempt: boolean }

/* Injection rules. attempt=true means the document tried to steer a model or
   execute something; attempt=false means instruction-like framing that is
   stripped but not hostile. */
const RULES: Rule[] = [
  { name: 'override_instructions', re: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i, attempt: true },
  { name: 'disregard_rules', re: /disregard\s+(all\s+)?(previous|prior|above)/i, attempt: true },
  { name: 'role_hijack', re: /^\s*(system|assistant|developer)\s*:/im, attempt: true },
  { name: 'chat_markers', re: /<\|?(im_start|im_end|endoftext|system)\|?>/i, attempt: true },
  { name: 'prompt_frame', re: /\[\/?(INST|SYSTEM)\]/i, attempt: true },
  { name: 'execute_command', re: /(run|execute)\s+the\s+following\s+(command|code|instruction)/i, attempt: true },
  { name: 'tool_invocation', re: /```(tool_call|function_call|json)\b/i, attempt: true },
  { name: 'secret_exfil', re: /(api[_-]?key|secret[_-]?key|password\s*=)\s*[:=]/i, attempt: true },
  { name: 'you_are_now', re: /you\s+are\s+now\s+(a|an|the)\b/i, attempt: false },
  { name: 'act_as', re: /\bact\s+as\s+(an?|the)\b/i, attempt: false },
];

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

export interface QuarantineResult {
  artifact: Artifact;
  events: Array<{ kind: 'stripped_instruction' | 'injection_attempt' | 'rejected'; detail: string }>;
}

export function extract(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')           // strip html tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(ZERO_WIDTH, ' ')            // homoglyph and zero-width tricks
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function sanitize(text: string): { clean: string; hits: Array<{ name: string; excerpt: string; attempt: boolean }> } {
  const hits: Array<{ name: string; excerpt: string; attempt: boolean }> = [];
  const lines = text.split(/\r?\n/);
  const kept = lines.filter(line => {
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        hits.push({ name: rule.name, excerpt: line.slice(0, 80), attempt: rule.attempt });
        return false;
      }
    }
    return true;
  });
  return { clean: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), hits };
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const DATE = /\b(0[1-9]|1[0-2])\/\d{4}\b/g;

export function structure(kind: ArtifactKind, text: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    paragraphs: text.split(/\n{2,}/).filter(p => p.trim()).length,
    emails: [...new Set(text.match(EMAIL) ?? [])],
    phones: [...new Set((text.match(PHONE) ?? []).map(p => p.trim()))].slice(0, 5),
    dates: [...new Set(text.match(DATE) ?? [])],
  };
  if (kind === 'jd') {
    const must = text.split(/\r?\n/).filter(l => /must[- ]have|required|essential/i.test(l)).slice(0, 20);
    fields.mustHave = must;
  }
  return fields;
}

export function quarantine(
  store: Store, ctx: Ctx,
  input: { candidateId: string; kind: ArtifactKind; title: string; raw: string; createdBy: string },
): QuarantineResult {
  const text = extract(input.raw);
  const { clean, hits } = sanitize(text);
  const attempts = hits.filter(h => h.attempt).length;
  const status: QuarantineStatus =
    attempts >= 3 ? 'rejected' : attempts > 0 ? 'sanitized' : hits.length > 0 ? 'sanitized' : 'clean';

  const artifact: Artifact = {
    id: randomUUID(), tenantId: ctx.tenantId, candidateId: input.candidateId,
    kind: input.kind, title: input.title, quarantine: status,
    fields: input.kind === 'resume'
      ? { ...structure(input.kind, clean), ...structureResume(clean) }
      : structure(input.kind, clean),
    sanitizedText: status === 'rejected' ? null : clean,
    content: null, injectionAttempts: attempts, createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
  };
  store.insertArtifact(artifact);

  const events: QuarantineResult['events'] = hits.map(h => ({
    kind: (h.attempt ? 'injection_attempt' : 'stripped_instruction') as 'injection_attempt' | 'stripped_instruction',
    detail: `${h.name}: ${h.excerpt.replace(/\s+/g, ' ')}`,
  }));
  if (status === 'rejected') {
    events.push({ kind: 'rejected', detail: 'Document rejected: repeated injection attempts' });
  }
  for (const e of events) {
    store.insertQuarantineEvent({
      id: randomUUID(), tenantId: ctx.tenantId, artifactId: artifact.id,
      kind: e.kind, detail: e.detail, ts: new Date().toISOString(),
    });
  }
  store.audit(ctx.tenantId, input.createdBy, 'system', 'artifact_ingest',
    `${artifact.id}:${input.kind}:${status}`);
  if (attempts > 0) {
    store.insertFlag({
      id: randomUUID(), tenantId: ctx.tenantId, candidateId: input.candidateId,
      type: 'jd_gap', status: 'open',
      title: 'Injection attempt in ingested document',
      body: `The ${input.kind} contained instruction-like content. It was stripped at ingestion and never executed. Attempts: ${attempts}.`,
      quote: events[0]?.detail ?? '', sourceRunId: null,
      createdAt: new Date().toISOString(),
    });
  }
  return { artifact, events };
}
