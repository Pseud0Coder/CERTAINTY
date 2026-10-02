/* Model-assisted resume parsing (ADR-0024). The deterministic parser in
   agents.ts is the floor and always runs first. When a model is configured
   AND the deterministic parser found no roles (a messy or unusual layout),
   the sanitized text is sent once to the model for a second attempt. The
   result is shape-validated; anything malformed or off-schema is discarded
   and the scripted result stands.

   L1 holds: only the sanitized text leaves this module, never raw artifact
   text, and the model's output is treated as data, never instructions. */

import type { LlmProvider, JsonSchema } from './providers/llm.ts';
import { structureResume, type ResumeFields } from './agents.ts';

const RESUME_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['positioning', 'location', 'phone', 'email', 'roles', 'skills', 'tools', 'education'],
  properties: {
    positioning: { type: 'string' },
    location: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    roles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company', 'title', 'start', 'end', 'bullets'],
        properties: {
          company: { type: 'string' }, title: { type: 'string' },
          start: { type: 'string' }, end: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    skills: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['group', 'items'], properties: { group: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } },
    },
    tools: { type: 'array', items: { type: 'string' } },
    education: { type: 'array', items: { type: 'string' } },
  },
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function validResume(v: unknown): v is ResumeFields {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (typeof r.positioning !== 'string') return false;
  if (!Array.isArray(r.roles)) return false;
  for (const role of r.roles) {
    if (!role || typeof role !== 'object') return false;
    const x = role as Record<string, unknown>;
    if (typeof x.title !== 'string' || typeof x.company !== 'string' || typeof x.start !== 'string' || typeof x.end !== 'string') return false;
    if (!isStringArray(x.bullets)) return false;
  }
  if (!Array.isArray(r.skills)) return false;
  for (const g of r.skills) {
    if (!g || typeof g !== 'object') return false;
    const x = g as Record<string, unknown>;
    if (typeof x.group !== 'string' || !isStringArray(x.items)) return false;
  }
  return isStringArray(r.tools) && isStringArray(r.education)
    && typeof r.location === 'string' && typeof r.phone === 'string' && typeof r.email === 'string';
}

const SYSTEM = 'You extract structured resume fields from sanitized CV text. Return only the schema. Never invent roles, dates, employers or skills that are not present in the text.';

export interface AssistedParse { fields: ResumeFields; by: 'model' | 'scripted' }

/* The deterministic parse always runs. The model is consulted only when the
   deterministic parse found nothing structural, and only its valid output
   is ever used. */
export async function structureResumeAssisted(llm: LlmProvider | undefined | null, sanitizedText: string): Promise<AssistedParse> {
  const scripted = structureResume(sanitizedText);
  if (scripted.roles.length > 0) return { fields: scripted, by: 'scripted' };
  if (!llm || llm.name === 'scripted' || !sanitizedText.trim()) return { fields: scripted, by: 'scripted' };
  const result = await llm.complete<ResumeFields>({
    system: SYSTEM, user: sanitizedText, schema: RESUME_SCHEMA,
    schemaName: 'resume_fields', tier: 'cheap', seed: 7,
  });
  if (!result || !validResume(result.value)) return { fields: scripted, by: 'scripted' };
  return { fields: result.value, by: 'model' };
}
