/* Production bootstrap (ADR-0027). A deployment with real users does not
   ship with the demo accounts: set CERTAINTY_DEMO=off and give the first
   account through the environment. Idempotent, and never overwrites an
   existing account's password, so changing the variable later does not lock
   anyone out or reset anything. */
import type { Store } from './db.ts';
import { hashPassword } from './seed.ts';
import { MODULES } from './billing.ts';

export interface BootstrapResult { created: string[]; skipped: string[] }

export function ensureOwner(store: Store, env: NodeJS.ProcessEnv = process.env): BootstrapResult {
  const result: BootstrapResult = { created: [], skipped: [] };
  const email = env.CERTAINTY_OWNER_EMAIL?.trim().toLowerCase();
  const password = env.CERTAINTY_OWNER_PASSWORD ?? '';
  if (!email || !password) return result;
  if (password.length < 10) throw new Error('CERTAINTY_OWNER_PASSWORD must be at least 10 characters');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('CERTAINTY_OWNER_EMAIL is not an email address');

  if (store.userByEmail(email)) { result.skipped.push(email); return result; }
  const agency = env.CERTAINTY_AGENCY_NAME?.trim() || 'Certainty';
  const tenant = store.createTenant(agency);
  for (const m of MODULES) store.setEntitlement(tenant.id, m, true);
  const hash = hashPassword(password);
  const name = env.CERTAINTY_OWNER_NAME?.trim() || email.split('@')[0]!;
  store.createUser(tenant.id, email, hash, 'recruiter', name);
  result.created.push(email);

  /* An optional admin for the same tenant, with the same password. */
  const adminEmail = env.CERTAINTY_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail && adminEmail !== email && !store.userByEmail(adminEmail)) {
    store.createUser(tenant.id, adminEmail, hash, 'admin', `${name} (admin)`);
    result.created.push(adminEmail);
  }
  store.audit(tenant.id, 'system', 'system', 'owner_bootstrap', email);
  return result;
}
