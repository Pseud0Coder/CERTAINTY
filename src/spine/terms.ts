/* Requirement terms (ADR-0027). The research agent's `keywords` keeps every
   word of length three or more, which is right for a coarse match but too
   noisy to grade a requirement: "deep expertise in TypeScript, including
   advanced generics" would need the CV to say "deep" and "including" before a
   line counted as covering it. This keeps the words that carry the
   requirement and reduces them to a stem, so "optimizing" meets
   "optimized". Deterministic, offline, and shared by the screening engine
   and the GitHub analyst. */
import { keywords } from './agents.ts';

const FLUFF = new Set([
  'deep', 'expertise', 'including', 'include', 'includes', 'proven', 'track', 'record', 'years', 'year', 'plus',
  'excellent', 'ability', 'able', 'knowledge', 'proficiency', 'proficient', 'working', 'work', 'using', 'used', 'use',
  'building', 'build', 'built', 'production', 'real', 'world', 'etc', 'such', 'other', 'related', 'relevant', 'similar',
  'demonstrated', 'demonstrable', 'solid', 'extensive', 'hands', 'familiarity', 'familiar', 'understanding', 'good',
  'great', 'excellent', 'preferred', 'bonus', 'nice', 'desirable', 'minimum', 'least', 'more', 'than', 'you', 'our', 'your',
  'will', 'who', 'are', 'can', 'one', 'two', 'three', 'both', 'each', 'within', 'across', 'between', 'while', 'where',
  'role', 'team', 'teams', 'company', 'candidate', 'candidates', 'looking', 'seeking', 'skills', 'skill', 'ideal',
]);

function stem(word: string): string {
  for (const suffix of ['ing', 'ed', 'es', 'ly', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

export function requirementTerms(text: string): string[] {
  const out: string[] = [];
  for (const w of keywords(text)) {
    if (FLUFF.has(w) || /^\d/.test(w)) continue;
    const s = stem(w);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
