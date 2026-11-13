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
  'improve', 'improving', 'improved', 'enhance', 'enhancing', 'meeting', 'meet', 'spoken', 'written', 'verbal', 'comfortable', 'ability',
]);

function stem(word: string): string {
  for (const suffix of ['ing', 'ed', 'es', 'ly', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  }
  return word;
}

/* Aliases (ADR-0029). A CV that says "K8s" meets a JD that says
   "Kubernetes". Each entry maps one canonical spelling to the ways people
   write it. Both sides of every comparison go through `canon`, so the
   canonical word is what gets matched, while quotes shown to a person always
   come from the original text. Ambiguous short forms ("go", "ts", "node") are
   left out on purpose: a wrong match is worse than a missed one. */
const ALIASES: Array<[string, string[]]> = [
  ['kubernetes', ['k8s', 'kube']],
  ['javascript', ['js', 'ecmascript', 'es6', 'es2015']],
  ['typescript', ['ts-node']],
  ['react', ['reactjs', 'react.js', 'react js']],
  ['next.js', ['nextjs', 'next js']],
  ['node.js', ['nodejs', 'node js']],
  ['vue', ['vuejs', 'vue.js']],
  ['angular', ['angularjs', 'angular.js']],
  ['postgres', ['postgresql', 'psql']],
  ['mongodb', ['mongo db', 'mongo']],
  ['golang', ['go lang']],
  ['aws', ['amazon web services']],
  ['gcp', ['google cloud platform', 'google cloud']],
  ['azure', ['microsoft azure']],
  ['ci/cd', ['cicd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment']],
  ['machine learning', ['ml']],
  ['nlp', ['natural language processing']],
  ['llm', ['llms', 'large language model', 'large language models']],
  ['sql', ['t-sql', 'tsql', 'pl/sql', 'plsql']],
  ['rest', ['restful', 'rest api', 'rest apis']],
  ['.net', ['dotnet', 'asp.net']],
  ['c#', ['csharp', 'c sharp']],
  ['c++', ['cpp']],
  ['scikit-learn', ['sklearn', 'scikit learn']],
  ['power bi', ['powerbi', 'power-bi']],
  ['tailwind', ['tailwindcss', 'tailwind css']],
  ['microservices', ['micro-services', 'micro services']],
  ['devops', ['dev-ops']],
  ['terraform', ['tf']],
  ['profit and loss', ['p&l', 'p and l', 'pnl']],
  ['b2b', ['business to business', 'business-to-business']],
  ['crm', ['customer relationship management']],
  ['erp', ['enterprise resource planning']],
  ['kpi', ['kpis', 'key performance indicator', 'key performance indicators']],
  ['seo', ['search engine optimization', 'search engine optimisation']],
  ['ux', ['user experience']],
  ['ui', ['user interface']],
  ['mis', ['management information system', 'management information systems']],
  ['gst', ['goods and services tax']],
  ['tds', ['tax deducted at source']],
  ['kyc', ['know your customer']],
  ['hr', ['human resources']],
];

const ALIAS_RULES: Array<[RegExp, string]> = ALIASES.map(([to, variants]) => {
  const alt = variants.map(v => v.replace(/[.*+?^${}()|[\]\\\/&]/g, '\\$&')).join('|');
  /* A leading dot is excluded so the "js" in "next.js" is never rewritten. */
  return [new RegExp(`(?<![a-z0-9+#.])(?:${alt})(?![a-z0-9+#])`, 'gi'), to] as [RegExp, string];
});

/* Lowercases and replaces every alias with its canonical spelling. */
export function canon(text: string): string {
  let out = text.toLowerCase();
  for (const [re, to] of ALIAS_RULES) out = out.replace(re, to);
  return out;
}

export const SKILL_TERMS = [
  'javascript', 'typescript', 'python', 'java', 'kotlin', 'swift', 'golang', 'rust', 'ruby', 'php', 'scala', 'c++', 'c#', '.net', 'sql', 'nosql',
  'react', 'angular', 'vue', 'svelte', 'next.js', 'nextjs', 'node.js', 'nodejs', 'express', 'django', 'flask', 'fastapi', 'spring', 'rails', 'laravel', 'graphql', 'rest', 'grpc',
  'html', 'css', 'tailwind', 'redux', 'webpack', 'vite', 'jest', 'cypress', 'playwright', 'selenium',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'ci/cd', 'linux', 'nginx', 'serverless', 'lambda',
  'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'kafka', 'rabbitmq', 'elasticsearch', 'snowflake', 'bigquery', 'spark', 'hadoop', 'airflow', 'dbt',
  'machine learning', 'deep learning', 'pytorch', 'tensorflow', 'scikit-learn', 'pandas', 'numpy', 'nlp', 'llm', 'computer vision',
  'android', 'ios', 'flutter', 'react native', 'figma', 'tableau', 'power bi', 'salesforce', 'sap', 'jira', 'git', 'github', 'agile', 'scrum', 'microservices',
  'prometheus', 'grafana', 'datadog', 'oauth', 'devops', 'sre', 'blockchain', 'solidity',
  /* Business, finance, sales, HR, operations, marketing and design. "excel"
     alone is not listed because "excel at" is ordinary English. */
  'ms excel', 'advanced excel', 'microsoft excel', 'vlookup', 'pivot tables', 'tally', 'tally erp', 'quickbooks', 'zoho', 'hubspot', 'sap fico', 'oracle',
  'gst', 'tds', 'kyc', 'aml', 'crm', 'erp', 'mis', 'b2b', 'b2c', 'profit and loss', 'financial modelling', 'financial modeling', 'valuation', 'budgeting', 'forecasting',
  'accounts payable', 'accounts receivable', 'internal audit', 'statutory audit', 'taxation', 'ifrs', 'ind as', 'payroll', 'credit risk', 'underwriting', 'equity research', 'mutual funds',
  'lead generation', 'cold calling', 'key account management', 'business development', 'channel sales', 'territory management', 'negotiation', 'customer success', 'customer support', 'voice process', 'bpo',
  'recruitment', 'talent sourcing', 'employee engagement', 'hr analytics', 'onboarding', 'talent acquisition',
  'supply chain', 'logistics', 'procurement', 'inventory management', 'warehouse management', 'six sigma', 'lean manufacturing', 'autocad', 'solidworks', 'plc', 'scada',
  'seo', 'sem', 'google analytics', 'google ads', 'facebook ads', 'content marketing', 'copywriting', 'social media marketing', 'photoshop', 'illustrator', 'canva', 'after effects', 'ux', 'ui', 'wireframing',
  'project management', 'pmp', 'stakeholder management',
];

/* Skill names written with punctuation ("CI/CD", "C++", "Node.js") are split
   into fragments too short to match by the word splitter, so for matching
   they are squashed to plain letters on both sides. Skill detection itself
   still reads the punctuated canonical spelling. */
const SQUASH: Array<[RegExp, string]> = [
  [/ci\/cd/g, 'cicd'], [/c\+\+/g, 'cplusplus'], [/c#/g, 'csharp'], [/\.net\b/g, 'dotnet'],
  [/next\.js/g, 'nextjs'], [/node\.js/g, 'nodejs'],
];
export function squash(text: string): string {
  let out = text;
  for (const [re, to] of SQUASH) out = out.replace(re, to);
  return out;
}

/* The form text takes for matching: aliases collapsed, then squashed. */
export function matchForm(text: string): string { return squash(canon(text)); }

/* Stems of the single-word skills above. A requirement that names one of
   these (Kubernetes, SAP, Tally) is mostly about that word, so it counts for
   more than the connecting words around it. */
const SKILL_STEMS = new Set(SKILL_TERMS.filter(t => !t.includes(' ')).map(t => stem(matchForm(t))));

/* Share of a requirement's terms found in `canonText`, with skill names
   weighted three times a plain word. */
export function weightedShare(terms: string[], canonText: string): number {
  if (!terms.length) return 0;
  let have = 0, all = 0;
  for (const t of terms) {
    const w = SKILL_STEMS.has(t) ? 3 : 1;
    all += w;
    if (canonText.includes(t)) have += w;
  }
  return have / all;
}

/* A requirement that offers a choice ("Jenkins or GitHub Actions", "a CRM such
   as HubSpot") is met by any one of the named skills. */
const ALTERNATIVES = /\b(?:or|such as|e\.g\.|like|similar to)\b|\//i;

/* How much of a requirement a piece of text covers, in 0..1. Skill names
   weigh three times a plain word, and when every named skill is present (or,
   for a choice, any one) the text counts as covering the requirement even if
   the connecting words differ. */
export function requirementShare(requirement: string, canonText: string, terms: string[] = requirementTerms(requirement)): number {
  if (!terms.length) return 0;
  const base = weightedShare(terms, canonText);
  const skills = terms.filter(t => SKILL_STEMS.has(t));
  if (!skills.length) return base;
  const choice = skills.length >= 2 && ALTERNATIVES.test(requirement);
  const hit = choice ? skills.some(t => canonText.includes(t)) : skills.every(t => canonText.includes(t));
  return hit ? Math.max(base, 0.8) : base;
}

/* Lines about willingness or logistics (shifts, relocation, notice period,
   office days) cannot be shown by a CV, so they are confirmed with the
   candidate instead of graded against it. */
const LOGISTICS = /\b(?:shifts?|rotational|relocat\w*|willing(?:ness)? to|ready to|open to|comfortable (?:with|working)|travel\w*|notice period|immediate joiner|work from office|wfo|wfh|hybrid|on-?site|night|weekend)\b/i;
export function isLogistics(requirement: string): boolean { return LOGISTICS.test(requirement); }

export function requirementTerms(text: string): string[] {
  const out: string[] = [];
  for (const w of keywords(matchForm(text))) {
    if (FLUFF.has(w) || /^\d/.test(w)) continue;
    const s = stem(w);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
