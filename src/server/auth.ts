/* Auth: email plus password, server-side sessions, scrypt hashing.
   Login decides the application (master prompt section 7). */
import { randomBytes, createHash } from 'node:crypto';
import type { Store } from '../spine/db.ts';
import type { User } from '../spine/types.ts';
import { verifyPassword } from '../spine/seed.ts';

export interface AuthSession { userId: string; exp: number; csrf: string }

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map<string, AuthSession>();

/* Simple in-process rate limit on login failures. */
const failures = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 60_000;
const MAX_FAILURES = 8;

export function loginRateLimited(key: string): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) { failures.delete(key); return false; }
  return f.count >= MAX_FAILURES;
}
export function recordFailure(key: string): void {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
export function clearFailures(key: string): void { failures.delete(key); }

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function login(store: Store, email: string, password: string):
  { user: User; token: string; csrf: string } | null {
  const user = store.userByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(16).toString('base64url');
  sessions.set(hashToken(token), { userId: user.id, exp: Date.now() + SESSION_TTL_MS, csrf });
  return { user, token, csrf };
}

export function logout(token: string): void {
  sessions.delete(hashToken(token));
}

export function sessionFor(token: string): AuthSession | null {
  const s = sessions.get(hashToken(token));
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(hashToken(token)); return null; }
  return s;
}

export function userForToken(store: Store, token: string): { user: User; csrf: string } | null {
  const s = sessionFor(token);
  if (!s) return null;
  const user = store.userById(s.userId);
  if (!user) return null;
  return { user, csrf: s.csrf };
}
