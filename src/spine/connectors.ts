/* Portfolio connectors (ADR-0022): GitHub and LeetCode as evidence.

   Three rules carry the design:
   1. Linked is a claim, proven is evidence. Anyone can paste someone
      else's username, so a link starts as "claimed". The candidate proves
      ownership by putting a one-time code in the account's public bio
      (GitHub bio, LeetCode summary); the next sync that sees the code marks
      the account verified. No OAuth app is needed for either provider.
   2. Fetching is sandboxed: a per-provider host allowlist, no redirects, a
      timeout and a response size cap, server side only.
   3. Fetched text is data (L1). Bios, repo descriptions and PR titles pass
      the same sanitizer as uploaded documents before they are stored. The
      figures are counted here in code; nothing is generated. */

import { randomBytes } from 'node:crypto';
import { extract, sanitize } from './quarantine.ts';

export type Provider = 'github' | 'leetcode';
export const PROVIDERS: Provider[] = ['github', 'leetcode'];

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class ConnectorError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const ALLOWED_HOSTS: Record<Provider, string[]> = {
  github: ['api.github.com'],
  leetcode: ['leetcode.com'],
};
const MAX_RESPONSE_BYTES = 1_000_000;
const TIMEOUT_MS = 8000;

async function sandboxedJson(provider: Provider, url: string, init: RequestInit, fetchImpl: FetchLike): Promise<unknown> {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS[provider].includes(host)) throw new ConnectorError('host_not_allowed');
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ConnectorError('provider_unreachable');
  }
  if (res.status === 404) throw new ConnectorError('account_not_found');
  if (res.status === 403 || res.status === 429) throw new ConnectorError('provider_rate_limited');
  if (!res.ok) throw new ConnectorError('provider_error');
  const body = await res.text();
  if (body.length > MAX_RESPONSE_BYTES) throw new ConnectorError('provider_response_too_large');
  try { return JSON.parse(body); } catch { throw new ConnectorError('provider_error'); }
}

/* Accepts a bare username or a profile URL. */
export function normalizeUsername(provider: Provider, input: string): string {
  const raw = input.trim();
  const fromUrl = provider === 'github'
    ? /github\.com\/([A-Za-z0-9-]+)/i.exec(raw)?.[1]
    : /leetcode\.com\/(?:u\/)?([A-Za-z0-9_-]+)/i.exec(raw)?.[1];
  const name = (fromUrl ?? raw).replace(/^@/, '');
  const ok = provider === 'github' ? /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(name) : /^[A-Za-z0-9_-]{1,40}$/.test(name);
  if (!ok) throw new ConnectorError('invalid_username');
  return name;
}

export function profileUrl(provider: Provider, username: string): string {
  return provider === 'github' ? `https://github.com/${username}` : `https://leetcode.com/u/${username}/`;
}

/* Short, unambiguous, and unlikely to appear in a bio by chance. */
export function verificationCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = randomBytes(6);
  return `certainty-${[...bytes].map(b => alphabet[b % alphabet.length]).join('')}`;
}

/* Sanitizes one fetched string; counts instruction-like content stripped. */
function clean(text: unknown, cap: number, tally: { attempts: number }): string {
  if (typeof text !== 'string' || !text) return '';
  const { clean: out, hits } = sanitize(extract(text.slice(0, cap * 2)));
  tally.attempts += hits.filter(h => h.attempt).length;
  return out.slice(0, cap);
}

/* ---------------------------------------------------------------------- */
/* GitHub                                                                  */

export interface GithubSnapshot {
  provider: 'github';
  username: string;
  bio: string;
  name: string;
  publicRepos: number;
  followers: number;
  accountSince: string;
  repos: Array<{ name: string; description: string; language: string | null; stars: number; pushedAt: string; url: string; topics: string[] }>;
  mergedPrs: Array<{ repo: string; title: string; mergedAt: string; url: string }>;
  languages: Array<{ name: string; repos: number }>;
  activeMonths: number;
  injectionAttempts: number;
}

export async function fetchGithub(username: string, fetchImpl: FetchLike, token?: string): Promise<GithubSnapshot> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json', 'user-agent': 'certainty-connector', 'x-github-api-version': '2022-11-28',
  };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const get = (path: string) => sandboxedJson('github', `https://api.github.com${path}`, { headers }, fetchImpl);
  const tally = { attempts: 0 };

  const user = await get(`/users/${encodeURIComponent(username)}`) as Record<string, unknown>;
  const repoList = await get(`/users/${encodeURIComponent(username)}/repos?per_page=100&type=owner&sort=pushed`) as Array<Record<string, unknown>>;
  /* Merged pull requests to repositories the candidate does not own: the
     strongest public signal of collaboration, and hard to game. */
  const prs = await get(`/search/issues?per_page=30&sort=updated&q=${encodeURIComponent(`author:${username} type:pr is:merged -user:${username}`)}`) as { items?: Array<Record<string, unknown>> };

  const repos = (Array.isArray(repoList) ? repoList : [])
    .filter(r => !r.fork && !r.archived)
    .map(r => ({
      name: clean(r.name, 100, tally),
      description: clean(r.description, 300, tally),
      language: typeof r.language === 'string' ? r.language : null,
      stars: Number(r.stargazers_count ?? 0),
      pushedAt: String(r.pushed_at ?? ''),
      url: String(r.html_url ?? ''),
      topics: Array.isArray(r.topics) ? (r.topics as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 10) : [],
    }))
    .sort((a, b) => b.stars - a.stars || b.pushedAt.localeCompare(a.pushedAt));

  const languageCounts = new Map<string, number>();
  for (const r of repos) if (r.language) languageCounts.set(r.language, (languageCounts.get(r.language) ?? 0) + 1);
  const languages = [...languageCounts].map(([name, n]) => ({ name, repos: n })).sort((a, b) => b.repos - a.repos);

  /* Months in the last year with a push to an owned repository. */
  const yearAgo = Date.now() - 365 * 24 * 3600 * 1000;
  const months = new Set(repos.filter(r => Date.parse(r.pushedAt) > yearAgo).map(r => r.pushedAt.slice(0, 7)));

  const mergedPrs = (prs.items ?? []).map(p => ({
    repo: String(p.repository_url ?? '').replace('https://api.github.com/repos/', ''),
    title: clean(p.title, 200, tally),
    mergedAt: String((p.pull_request as Record<string, unknown> | undefined)?.merged_at ?? p.closed_at ?? ''),
    url: String(p.html_url ?? ''),
  }));

  return {
    provider: 'github', username,
    bio: clean(user.bio, 300, tally),
    name: clean(user.name, 100, tally),
    publicRepos: Number(user.public_repos ?? 0),
    followers: Number(user.followers ?? 0),
    accountSince: String(user.created_at ?? '').slice(0, 10),
    repos: repos.slice(0, 30), mergedPrs, languages, activeMonths: months.size,
    injectionAttempts: tally.attempts,
  };
}

/* ---------------------------------------------------------------------- */
/* LeetCode: no official API. The public GraphQL endpoint the site itself  */
/* uses; best effort, fails closed, and the UI shows when it last synced.  */

export interface LeetcodeSnapshot {
  provider: 'leetcode';
  username: string;
  bio: string;
  ranking: number | null;
  solved: { easy: number; medium: number; hard: number; all: number };
  contest: { rating: number; attended: number; topPercentage: number | null } | null;
  badges: string[];
  injectionAttempts: number;
}

const LEETCODE_QUERY = `query certaintyProfile($username: String!) {
  matchedUser(username: $username) {
    username
    profile { aboutMe ranking }
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    badges { displayName }
  }
  userContestRanking(username: $username) { rating attendedContestsCount topPercentage }
}`;

export async function fetchLeetcode(username: string, fetchImpl: FetchLike): Promise<LeetcodeSnapshot> {
  const data = await sandboxedJson('leetcode', 'https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'certainty-connector', referer: 'https://leetcode.com' },
    body: JSON.stringify({ query: LEETCODE_QUERY, variables: { username } }),
  }, fetchImpl) as { data?: { matchedUser?: Record<string, any> | null; userContestRanking?: Record<string, any> | null } };
  const u = data.data?.matchedUser;
  if (!u) throw new ConnectorError('account_not_found');
  const tally = { attempts: 0 };
  const count = (d: string) => Number((u.submitStatsGlobal?.acSubmissionNum ?? []).find((x: any) => x.difficulty === d)?.count ?? 0);
  const c = data.data?.userContestRanking;
  return {
    provider: 'leetcode', username,
    bio: clean(u.profile?.aboutMe, 300, tally),
    ranking: typeof u.profile?.ranking === 'number' ? u.profile.ranking : null,
    solved: { easy: count('Easy'), medium: count('Medium'), hard: count('Hard'), all: count('All') },
    contest: c && typeof c.rating === 'number'
      ? { rating: Math.round(c.rating), attended: Number(c.attendedContestsCount ?? 0), topPercentage: typeof c.topPercentage === 'number' ? c.topPercentage : null }
      : null,
    badges: (u.badges ?? []).map((b: any) => clean(b.displayName, 60, tally)).filter(Boolean).slice(0, 12),
    injectionAttempts: tally.attempts,
  };
}

export type Snapshot = GithubSnapshot | LeetcodeSnapshot;

export async function fetchSnapshot(provider: Provider, username: string, fetchImpl: FetchLike, githubToken?: string): Promise<Snapshot> {
  return provider === 'github' ? fetchGithub(username, fetchImpl, githubToken) : fetchLeetcode(username, fetchImpl);
}

/* Ownership proof: the code must appear in the public bio. The code is
   letters, digits and one hyphen, which the sanitizer never strips, so the
   stored (sanitized) bio is the one checked. */
export function bioHasCode(snapshot: Snapshot, code: string): boolean {
  return snapshot.bio.includes(code);
}

/* Searchable evidence text for requirement matching (insight.ts). */
export function evidenceCorpus(snapshot: Snapshot): string {
  if (snapshot.provider === 'github') {
    return [
      ...snapshot.languages.map(l => l.name),
      ...snapshot.repos.flatMap(r => [r.name, r.description, ...r.topics]),
      ...snapshot.mergedPrs.flatMap(p => [p.repo, p.title]),
    ].join(' \n ').toLowerCase();
  }
  /* Solved problems are evidence of algorithms practice, nothing more. */
  return [...(snapshot.solved.all > 0 ? ['algorithms', 'data structures'] : []), ...snapshot.badges].join(' \n ').toLowerCase();
}
