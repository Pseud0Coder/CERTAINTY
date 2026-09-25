/* Output contracts (Addendum A7). Every agent output passes schema
   validation and deterministic post-processors before it can touch the
   spine. A failed contract is a run error, not a warning. */

export interface ContractContext {
  clientFacing: boolean;
  currentCompensation: string | null;
  cvTenureStart: string | null;
  cvTenureEnd: string | null;
}

export interface ContractResult { ok: boolean; errors: string[] }

function emDashLint(text: string): string[] {
  const errors: string[] = [];
  if (text.includes('\u2014')) errors.push('em dash found in output string');
  if (text.includes('\u2013')) errors.push('en dash found in output string, use hyphen');
  return errors;
}

function emojiLint(text: string): string[] {
  const re = /\p{Extended_Pictographic}/u;
  return re.test(text) ? ['emoji found in output string'] : [];
}

/* L8: sentence case. Allowlisted acronyms may appear uppercase. */
const CAPS_ALLOWLIST = new Set([
  'API', 'AWS', 'Interviewer', 'CV', 'JD', 'KPI', 'LLC', 'PANDL', 'PDF', 'QA', 'SaaS',
  'SQL', 'STAR', 'SWE', 'UK', 'US', 'USA', 'REST', 'WCAG', 'M',
]);

function capsLint(text: string): string[] {
  const words = text.split(/[^A-Za-z&]+/).filter(w => w.length >= 4 && /^[A-Z]+$/.test(w));
  const bad = words.filter(w => !CAPS_ALLOWLIST.has(w));
  return bad.length ? [`all-caps labels found: ${[...new Set(bad)].join(', ')}`] : [];
}

function compensationScrubber(text: string, ctx: ContractContext): string[] {
  if (!ctx.clientFacing || !ctx.currentCompensation) return [];
  const comp = ctx.currentCompensation.replace(/[£$,\s]/g, '');
  const digits = comp.replace(/\D/g, '');
  const errors: string[] = [];
  if (comp && text.replace(/[£$,\s]/g, '').includes(comp)) {
    errors.push('current compensation leaked into client-facing output');
  } else if (digits.length >= 4 && text.replace(/[£$,\s]/g, '').includes(digits)) {
    errors.push('current compensation figure leaked into client-facing output');
  }
  return errors;
}

function parseMY(s: string): number | null {
  const m = /^(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return Number(m[2]) * 12 + (Number(m[1]) - 1);
}

function dateConsistency(text: string, ctx: ContractContext): string[] {
  const start = ctx.cvTenureStart ? parseMY(ctx.cvTenureStart) : null;
  const end = ctx.cvTenureEnd ? parseMY(ctx.cvTenureEnd) : null;
  if (start === null && end === null) return [];
  const errors: string[] = [];
  const found = text.match(/\b(0[1-9]|1[0-2])\/\d{4}\b/g) ?? [];
  for (const d of found) {
    const m = parseMY(d);
    if (m === null) continue;
    if (start !== null && m < start) errors.push(`date ${d} precedes the conservative record start`);
    if (end !== null && m > end) errors.push(`date ${d} exceeds the conservative record end`);
  }
  return errors;
}

/* Date consistency applies to client-facing documents only: internal notes
   legitimately state all conflicting versions (L5: all versions stated). */
const POSTPROCESSORS: Array<(text: string, ctx: ContractContext) => string[]> = [
  emDashLint, emojiLint, capsLint,
  (t, c) => compensationScrubber(t, c),
  (t, c) => (c.clientFacing ? dateConsistency(t, c) : []),
];

/* Runs every post-processor over every string in a structured output.
   Structured output only into the spine; free text flows only to chat and
   voice surfaces, which the engine marks as such. */
export function runContract(output: unknown, ctx: ContractContext): ContractResult {
  const errors: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') errors.push(...POSTPROCESSORS.flatMap(p => p(v, ctx)));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(output);
  return { ok: errors.length === 0, errors };
}

export const CONTRACT_NAMES = ['submission_deliverable', 'session_metrics', 'task_projection', 'handoff_block'];
export function knownContract(name: string): boolean {
  return CONTRACT_NAMES.includes(name);
}

/* ---------------------------------------------------------------------- */
/* Model output normalization (A7: deterministic post-processors).

   A language model reliably violates the typographic rules in L8 no matter
   what the prompt says: em dashes, emoji and smart quotes are baked into
   its output distribution. Asking it more firmly does not fix that, so
   these substitutions run over model output before the contract is
   evaluated. They are mechanical and lossless in meaning.

   What is deliberately NOT repaired here: all-caps labels. Rewriting an
   unrecognized acronym would corrupt it (GDPR becoming Gdpr), so caps
   remain a genuine contract failure that retries and then falls back to
   the scripted implementation. */

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

export function normalizeModelText(text: string): string {
  return text
    /* Spaced em or en dash becomes a spaced hyphen; bare becomes bare. */
    .replace(/\s*[—–]\s*/g, m => (/^\s|\s$/.test(m) ? ' - ' : '-'))
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(ZERO_WIDTH, '')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    /* Emoji removal can leave doubled spaces or a space before punctuation. */
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .replace(/[ \t]+$/gm, '');
}

/* Applies normalizeModelText to every string in a structured value,
   preserving shape. Keys are left untouched: they are schema-defined. */
export function normalizeModelOutput<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return normalizeModelText(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
