/* Profile Agent: recruiter provisions a candidate from an email address.
   The agent creates the profile and generates the candidate's password,
   returned to the recruiter exactly once for sharing (master flow step 0). */
import { randomUUID, randomInt } from 'node:crypto';
import type { Store, Ctx } from './db.ts';
import type { Candidate } from './types.ts';
import { hashPassword } from './seed.ts';

const WORDS = [
  'harbour', 'ledger', 'meadow', 'lantern', 'pebble', 'willow', 'anchor', 'cobalt',
  'marble', 'garnet', 'cedar', 'ember', 'sable', 'quartz', 'fathom', 'almond',
];

export function generatePassword(): string {
  const pick = () => WORDS[randomInt(0, WORDS.length)]!;
  return `${pick()}-${pick()}-${randomInt(1000, 9999)}`;
}

export interface ProvisionInput {
  email: string;
  name: string;
  targetRole: string;
  targetCompany?: string | null;
}

export interface ProvisionResult {
  candidate: Candidate;
  userId: string;
  credentials: { email: string; password: string };
}

export function provisionCandidate(store: Store, ctx: Ctx, input: ProvisionInput, actor: string): ProvisionResult {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('invalid_email');
  if (!input.name.trim()) throw new Error('name_required');
  if (store.userByEmail(email)) throw new Error('email_exists');

  const password = generatePassword();
  const user = store.createUser(ctx.tenantId, email, hashPassword(password), 'candidate', input.name.trim());
  /* The recruiter sees this password once, to hand over. It is temporary:
     the candidate must choose their own before using the app. */
  store.setPassword(user.id, user.passwordHash, true);
  const candidate: Candidate = {
    id: randomUUID(), tenantId: ctx.tenantId, userId: user.id,
    name: input.name.trim(), targetRole: input.targetRole.trim() || 'Target role',
    targetCompany: input.targetCompany?.trim() || null,
    employer: '', tenure: '', cvTenureStart: null, cvTenureEnd: null,
    stage: 'Screening', parked: false, linkedinStatus: 'not linked',
    currentCompensation: null, compExpectations: null, noticePeriod: null, motivation: null,
    createdAt: new Date().toISOString(),
  };
  store.insertCandidate(candidate);
  store.audit(ctx.tenantId, `agent:profile_agent`, 'system', 'candidate_provisioned', candidate.id);
  return { candidate, userId: user.id, credentials: { email, password } };
}
