/* Billing and entitlements (master prompt section 12). Per-module
   subscription per tenant. ModuleEntitlement gates rail, API and flow
   access. Usage meters feed the invoice projection. Stripe sits behind an
   adapter; without keys the invoice projection still works (ADR-0005). */
import type { Store } from './db.ts';

export class ModuleError extends Error {
  module: string;
  constructor(module: string) { super(`module_not_entitled:${module}`); this.module = module; }
}

export const MODULES = [
  'pipeline', 'screener', 'builder', 'notes',
  'journey', 'resume_studio', 'linkedin_studio', 'practice',
  'admin', 'billing',
] as const;
export type Module = (typeof MODULES)[number];

export function assertModule(store: Store, tenantId: string, module: string): void {
  const ent = store.entitlements(tenantId).find(e => e.module === module);
  if (!ent || !ent.enabled) throw new ModuleError(module);
}

const MONTHLY_PRICE: Record<string, number> = {
  pipeline: 149, screener: 199, builder: 249, notes: 99,
  journey: 0, resume_studio: 129, linkedin_studio: 99, practice: 129,
  admin: 0, billing: 0,
};

const METER_RATES: Record<string, number> = {
  voice_minutes: 0.09, generations: 0.4, stt_seconds: 0.0002, llm_tokens: 0.000003,
};

export function invoice(store: Store, tenantId: string) {
  const ents = store.entitlements(tenantId).filter(e => e.enabled);
  const subscriptions = ents.map(e => ({ module: e.module, monthly: MONTHLY_PRICE[e.module] ?? 0 }));
  const meters = store.usage(tenantId).map(m => ({
    kind: m.kind, quantity: m.total, amount: Math.round(m.total * (METER_RATES[m.kind] ?? 0) * 10000) / 10000,
  }));
  const subscriptionTotal = subscriptions.reduce((a, s) => a + s.monthly, 0);
  const meteredTotal = Math.round(meters.reduce((a, m) => a + m.amount, 0) * 100) / 100;
  return {
    currency: 'GBP', subscriptions, meters,
    subscriptionTotal, meteredTotal,
    total: Math.round((subscriptionTotal + meteredTotal) * 100) / 100,
    provider: process.env.STRIPE_KEY ? 'stripe' : 'invoice-projection (Stripe adapter not configured)',
  };
}
