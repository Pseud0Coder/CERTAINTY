/* Single sign-on (ADR-0024), Microsoft Entra ID in production. The identity
   provider sits behind an interface and fails closed: with no
   CERTAINTY_ENTRA_VERIFY_URL configured, the route cannot issue a session.

   Sign-in never creates an account. A person is only signed in if their
   email already has a user in the tenant, so an SSO assertion cannot mint
   access to a tenant it was not provisioned for. */

import type { Store } from './db.ts';
import type { User } from './types.ts';

export interface SsoIdentity { email: string; name: string }

export interface SsoProvider {
  readonly name: string;
  verify(token: string): Promise<SsoIdentity | null>;
}

/* A verifier endpoint that takes `{ token }` and returns `{ email, name }`.
   Production points this at Entra token validation; tests point it at a
   fake. No URL, no provider. */
export function entraFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>): SsoProvider | null {
  const url = env.CERTAINTY_ENTRA_VERIFY_URL;
  if (!url) return null;
  const doFetch = fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  return {
    name: 'entra',
    async verify(token: string): Promise<SsoIdentity | null> {
      try {
        const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
        if (!res.ok) return null;
        const data = await res.json() as { email?: string; name?: string };
        if (!data.email) return null;
        return { email: data.email.toLowerCase(), name: data.name ?? data.email };
      } catch {
        return null;
      }
    },
  };
}

/* Verify, then sign in only an existing user. When a tenant is supplied the
   user must belong to it; otherwise the user's own tenant is used. */
export async function resolveSsoUser(store: Store, provider: SsoProvider | null, token: string, tenantId?: string): Promise<User | null> {
  if (!provider) return null;
  const identity = await provider.verify(token);
  if (!identity) return null;
  const user = store.userByEmail(identity.email);
  if (!user) return null;
  if (tenantId && user.tenantId !== tenantId) return null;
  return user;
}
