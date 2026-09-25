/* Certainty spine storage. Tenant isolation is enforced here, at the query
   layer (L9): every method takes the tenant id explicitly and parameterizes
   it into the WHERE clause. No method accepts raw SQL. */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  Artifact, AuditEvent, Candidate, CandidateTask, ConsentRecord, FlowDef,
  FlowRun, Flag, InterviewSession, ModuleEntitlement, QuarantineEvent,
  Tenant, UsageMeter, User, Role,
} from './types.ts';

export interface Ctx { tenantId: string }

export class Store {
  db: DatabaseSync;
  onEvent: ((tenantId: string, topic: string, payload: unknown) => void) | null = null;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.ensureSchema();
    this.migrate();
  }

  /* Additive migrations for databases created before a column existed. */
  private migrate(): void {
    const cols = (this.db.prepare('PRAGMA table_info(candidates)').all() as unknown as Array<{ name: string }>)
      .map(c => c.name);
    if (!cols.includes('target_company')) {
      this.db.exec('ALTER TABLE candidates ADD COLUMN target_company TEXT');
    }
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL, role TEXT NOT NULL, display_name TEXT NOT NULL,
        created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT,
        name TEXT NOT NULL, target_role TEXT NOT NULL, target_company TEXT,
        employer TEXT NOT NULL,
        tenure TEXT NOT NULL, cv_tenure_start TEXT, cv_tenure_end TEXT,
        stage TEXT NOT NULL, parked INTEGER NOT NULL DEFAULT 0,
        linkedin_status TEXT NOT NULL DEFAULT '',
        current_compensation TEXT, comp_expectations TEXT, notice_period TEXT,
        motivation TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS consents (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
        session_id TEXT, scope TEXT NOT NULL, granted_at TEXT, withdrawn_at TEXT,
        retention_policy TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
        flow_run_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL,
        date TEXT NOT NULL, duration TEXT NOT NULL DEFAULT '',
        star TEXT, ownership REAL, trailing INTEGER,
        transcript TEXT NOT NULL DEFAULT '[]', debrief TEXT,
        consent_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS flags (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
        type TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL,
        body TEXT NOT NULL, quote TEXT NOT NULL DEFAULT '', source_run_id TEXT,
        created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
        kind TEXT NOT NULL, title TEXT NOT NULL, quarantine TEXT NOT NULL,
        fields TEXT NOT NULL DEFAULT '{}', sanitized_text TEXT,
        content TEXT, injection_attempts INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, candidate_id TEXT NOT NULL,
        type TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL,
        title TEXT NOT NULL, body TEXT NOT NULL, flag_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor TEXT NOT NULL,
        role TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
        ts TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quarantine_events (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
        kind TEXT NOT NULL, detail TEXT NOT NULL, ts TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS flow_defs (
        flow_id TEXT NOT NULL, version INTEGER NOT NULL, tenant_id TEXT NOT NULL,
        title TEXT NOT NULL, def TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        PRIMARY KEY (flow_id, version, tenant_id));
      CREATE TABLE IF NOT EXISTS flow_runs (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, flow_id TEXT NOT NULL,
        flow_version INTEGER NOT NULL, candidate_id TEXT NOT NULL,
        actor_role TEXT NOT NULL, status TEXT NOT NULL, current_step TEXT,
        step_states TEXT NOT NULL DEFAULT '{}', retries TEXT NOT NULL DEFAULT '{}',
        error TEXT, trace TEXT NOT NULL DEFAULT '[]',
        tool_calls TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entitlements (
        tenant_id TEXT NOT NULL, module TEXT NOT NULL, enabled INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, module));
      CREATE TABLE IF NOT EXISTS usage_meters (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL,
        quantity REAL NOT NULL, ref_id TEXT NOT NULL, ts TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prompts (
        flow_id TEXT NOT NULL, agent TEXT NOT NULL, version INTEGER NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (flow_id, agent, version));
      CREATE INDEX IF NOT EXISTS ix_candidates_tenant ON candidates(tenant_id);
      CREATE INDEX IF NOT EXISTS ix_audit_tenant ON audit_events(tenant_id, ts);
      CREATE INDEX IF NOT EXISTS ix_flags_tenant ON flags(tenant_id, candidate_id);
      CREATE INDEX IF NOT EXISTS ix_artifacts_tenant ON artifacts(tenant_id, candidate_id);
    `);
  }

  emit(tenantId: string, topic: string, payload: unknown): void {
    this.onEvent?.(tenantId, topic, payload);
  }

  /* ---- audit (L6): append-only, no update or delete path exists ---- */
  audit(tenantId: string, actor: string, role: string, action: string, target: string): AuditEvent {
    const e: AuditEvent = {
      id: randomUUID(), tenantId, actor, role: role as AuditEvent['role'],
      action, target, ts: new Date().toISOString(),
    };
    this.db.prepare(
      'INSERT INTO audit_events (id, tenant_id, actor, role, action, target, ts) VALUES (?,?,?,?,?,?,?)')
      .run(e.id, e.tenantId, e.actor, e.role, e.action, e.target, e.ts);
    return e;
  }
  auditList(ctx: Ctx, limit = 200): AuditEvent[] {
    return this.db.prepare(
      'SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY ts DESC LIMIT ?')
      .all(ctx.tenantId, limit) as unknown as AuditEvent[];
  }

  /* ---- tenants and users ---- */
  createTenant(name: string): Tenant {
    const t: Tenant = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)')
      .run(t.id, t.name, t.createdAt);
    return t;
  }
  createUser(tenantId: string, email: string, passwordHash: string, role: Role, displayName: string): User {
    const u: User = {
      id: randomUUID(), tenantId, email: email.toLowerCase(), passwordHash,
      role, displayName, createdAt: new Date().toISOString(),
    };
    this.db.prepare(
      'INSERT INTO users (id, tenant_id, email, password_hash, role, display_name, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(u.id, u.tenantId, u.email, u.passwordHash, u.role, u.displayName, u.createdAt);
    return u;
  }
  userByEmail(email: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
      { id: string; tenant_id: string; email: string; password_hash: string; role: Role; display_name: string; created_at: string } | undefined;
    return row ? rowToUser(row) : null;
  }
  userById(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      { id: string; tenant_id: string; email: string; password_hash: string; role: Role; display_name: string; created_at: string } | undefined;
    return row ? rowToUser(row) : null;
  }
  listUsers(ctx: Ctx): Array<Pick<User, 'id' | 'email' | 'role' | 'displayName'>> {
    return (this.db.prepare(
      'SELECT id, email, role, display_name FROM users WHERE tenant_id = ? ORDER BY created_at')
      .all(ctx.tenantId) as any[]).map(r => ({ id: r.id, email: r.email, role: r.role, displayName: r.display_name }));
  }

  /* ---- candidates ---- */
  insertCandidate(c: Candidate): void {
    this.db.prepare(`INSERT INTO candidates (id, tenant_id, user_id, name, target_role, target_company,
      employer, tenure, cv_tenure_start, cv_tenure_end, stage, parked, linkedin_status,
      current_compensation, comp_expectations, notice_period, motivation, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(c.id, c.tenantId, c.userId, c.name, c.targetRole, c.targetCompany, c.employer, c.tenure,
        c.cvTenureStart, c.cvTenureEnd, c.stage, c.parked ? 1 : 0, c.linkedinStatus,
        c.currentCompensation, c.compExpectations, c.noticePeriod, c.motivation, c.createdAt);
  }
  candidate(ctx: Ctx, id: string): Candidate | null {
    const row = this.db.prepare('SELECT * FROM candidates WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, id) as any;
    return row ? rowToCandidate(row) : null;
  }
  candidateByUser(ctx: Ctx, userId: string): Candidate | null {
    const row = this.db.prepare('SELECT * FROM candidates WHERE tenant_id = ? AND user_id = ?')
      .get(ctx.tenantId, userId) as any;
    return row ? rowToCandidate(row) : null;
  }
  candidates(ctx: Ctx): Candidate[] {
    return (this.db.prepare('SELECT * FROM candidates WHERE tenant_id = ? ORDER BY created_at')
      .all(ctx.tenantId) as any[]).map(rowToCandidate);
  }
  updateCandidate(ctx: Ctx, id: string, patch: Partial<Candidate>): void {
    const sets: string[] = []; const vals: unknown[] = [];    const map: Record<string, string> = {
      stage: 'stage', parked: 'parked', linkedinStatus: 'linkedin_status',
      targetCompany: 'target_company',
      currentCompensation: 'current_compensation', compExpectations: 'comp_expectations',
      noticePeriod: 'notice_period', motivation: 'motivation',
      cvTenureStart: 'cv_tenure_start', cvTenureEnd: 'cv_tenure_end',
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        const v = (patch as Record<string, unknown>)[k];
        vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }
    }
    if (!sets.length) return;
    this.db.prepare(`UPDATE candidates SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`)
      .run(...(vals as any), ctx.tenantId, id);
    this.emit(ctx.tenantId, 'candidate.changed', { id });
  }

  /* ---- consents (L4) ---- */
  insertConsent(c: ConsentRecord): void {
    this.db.prepare(`INSERT INTO consents (id, tenant_id, candidate_id, session_id, scope,
      granted_at, withdrawn_at, retention_policy, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(c.id, c.tenantId, c.candidateId, c.sessionId, c.scope, c.grantedAt,
        c.withdrawnAt, c.retentionPolicy, c.createdAt);
  }
  consent(ctx: Ctx, id: string): ConsentRecord | null {
    const row = this.db.prepare('SELECT * FROM consents WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, id) as any;
    return row ? rowToConsent(row) : null;
  }
  withdrawConsent(ctx: Ctx, id: string): void {
    this.db.prepare('UPDATE consents SET withdrawn_at = ? WHERE tenant_id = ? AND id = ? AND withdrawn_at IS NULL')
      .run(new Date().toISOString(), ctx.tenantId, id);
    this.emit(ctx.tenantId, 'consent.withdrawn', { id });
  }

  /* ---- sessions ---- */
  insertSession(s: InterviewSession): void {
    this.db.prepare(`INSERT INTO sessions (id, tenant_id, candidate_id, flow_run_id, mode, status,
      date, duration, star, ownership, trailing, transcript, debrief, consent_id, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(s.id, s.tenantId, s.candidateId, s.flowRunId, s.mode, s.status, s.date, s.duration,
        s.star ? JSON.stringify(s.star) : null, s.ownership, s.trailing,
        JSON.stringify(s.transcript), s.debrief, s.consentId, s.createdAt);
    this.emit(s.tenantId, 'session.changed', { id: s.id, candidateId: s.candidateId });
  }
  session(ctx: Ctx, id: string): InterviewSession | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, id) as any;
    return row ? rowToSession(row) : null;
  }
  sessions(ctx: Ctx, candidateId: string): InterviewSession[] {
    return (this.db.prepare(
      'SELECT * FROM sessions WHERE tenant_id = ? AND candidate_id = ? ORDER BY created_at')
      .all(ctx.tenantId, candidateId) as any[]).map(rowToSession);
  }
  updateSession(ctx: Ctx, id: string, patch: Partial<InterviewSession>): void {
    const sets: string[] = []; const vals: unknown[] = [];
    const map: Record<string, string> = {
      status: 'status', duration: 'duration', ownership: 'ownership', trailing: 'trailing',
      debrief: 'debrief', flowRunId: 'flow_run_id',
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) { sets.push(`${col} = ?`); vals.push((patch as Record<string, unknown>)[k]); }
    }
    if ('star' in patch) {
      sets.push('star = ?');
      vals.push(patch.star ? JSON.stringify(patch.star) : null);
    }
    if ('transcript' in patch) { sets.push('transcript = ?'); vals.push(JSON.stringify(patch.transcript)); }
    if (!sets.length) return;
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`)
      .run(...(vals as any), ctx.tenantId, id);
    this.emit(ctx.tenantId, 'session.changed', { id });
  }

  /* ---- flags ---- */
  insertFlag(f: Flag): void {
    this.db.prepare(`INSERT INTO flags (id, tenant_id, candidate_id, type, status, title, body,
      quote, source_run_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(f.id, f.tenantId, f.candidateId, f.type, f.status, f.title, f.body, f.quote,
        f.sourceRunId, f.createdAt);
    this.emit(f.tenantId, 'flag.changed', { id: f.id, candidateId: f.candidateId });
  }
  flag(ctx: Ctx, id: string): Flag | null {
    const row = this.db.prepare('SELECT * FROM flags WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, id) as any;
    return row ? rowToFlag(row) : null;
  }
  flags(ctx: Ctx, candidateId?: string): Flag[] {
    const rows = candidateId
      ? this.db.prepare('SELECT * FROM flags WHERE tenant_id = ? AND candidate_id = ? ORDER BY created_at')
          .all(ctx.tenantId, candidateId) as any[]
      : this.db.prepare('SELECT * FROM flags WHERE tenant_id = ? ORDER BY created_at')
          .all(ctx.tenantId) as any[];
    return rows.map(rowToFlag);
  }
  setFlagStatus(ctx: Ctx, id: string, status: Flag['status']): void {
    this.db.prepare('UPDATE flags SET status = ? WHERE tenant_id = ? AND id = ?')
      .run(status, ctx.tenantId, id);
    this.emit(ctx.tenantId, 'flag.changed', { id });
  }

  /* ---- artifacts ---- */
  insertArtifact(a: Artifact): void {
    this.db.prepare(`INSERT INTO artifacts (id, tenant_id, candidate_id, kind, title, quarantine,
      fields, sanitized_text, content, injection_attempts, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(a.id, a.tenantId, a.candidateId, a.kind, a.title, a.quarantine, JSON.stringify(a.fields),
        a.sanitizedText, a.content, a.injectionAttempts, a.createdBy, a.createdAt);
    this.emit(a.tenantId, 'artifact.changed', { id: a.id, candidateId: a.candidateId });
  }
  artifact(ctx: Ctx, id: string): Artifact | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, id) as any;
    return row ? rowToArtifact(row) : null;
  }
  artifacts(ctx: Ctx, candidateId: string, kind?: string): Artifact[] {
    const rows = kind
      ? this.db.prepare(
          'SELECT * FROM artifacts WHERE tenant_id = ? AND candidate_id = ? AND kind = ? ORDER BY created_at')
          .all(ctx.tenantId, candidateId, kind) as any[]
      : this.db.prepare(
          'SELECT * FROM artifacts WHERE tenant_id = ? AND candidate_id = ? ORDER BY created_at')
          .all(ctx.tenantId, candidateId) as any[];
    return rows.map(rowToArtifact);
  }
  updateArtifactContent(ctx: Ctx, id: string, content: string): void {
    this.db.prepare('UPDATE artifacts SET content = ? WHERE tenant_id = ? AND id = ?')
      .run(content, ctx.tenantId, id);
    this.emit(ctx.tenantId, 'artifact.changed', { id });
  }
  /* Public share links: the artifact id is the unguessable capability
     token. There is no session to scope this lookup by tenant (the whole
     point is an anonymous link), so this deliberately bypasses the usual
     tenant-scoped access pattern (L9's normal rule) and is restricted to
     a single artifact kind: a leaked id can only ever resolve to a
     profile page, never an internal artifact. */
  publicProfilePage(id: string): Artifact | null {
    const row = this.db.prepare(
      "SELECT * FROM artifacts WHERE id = ? AND kind = 'profile_page' AND quarantine != 'rejected'")
      .get(id) as any;
    return row ? rowToArtifact(row) : null;
  }

  /* ---- quarantine events ---- */
  insertQuarantineEvent(q: QuarantineEvent): void {
    this.db.prepare(
      'INSERT INTO quarantine_events (id, tenant_id, artifact_id, kind, detail, ts) VALUES (?,?,?,?,?,?)')
      .run(q.id, q.tenantId, q.artifactId, q.kind, q.detail, q.ts);
  }
  quarantineEvents(ctx: Ctx, artifactId: string): QuarantineEvent[] {
    return this.db.prepare(
      'SELECT * FROM quarantine_events WHERE tenant_id = ? AND artifact_id = ? ORDER BY ts')
      .all(ctx.tenantId, artifactId) as unknown as QuarantineEvent[];
  }

  /* ---- tasks ---- */
  insertTask(t: CandidateTask): void {
    this.db.prepare(`INSERT INTO tasks (id, tenant_id, candidate_id, type, done, source, title,
      body, flag_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(t.id, t.tenantId, t.candidateId, t.type, t.done ? 1 : 0, t.source, t.title, t.body,
        t.flagId, t.createdAt);
    this.emit(t.tenantId, 'task.changed', { id: t.id, candidateId: t.candidateId });
  }
  tasks(ctx: Ctx, candidateId: string): CandidateTask[] {
    return (this.db.prepare(
      'SELECT * FROM tasks WHERE tenant_id = ? AND candidate_id = ? ORDER BY created_at')
      .all(ctx.tenantId, candidateId) as any[]).map(rowToTask);
  }
  setTaskDone(ctx: Ctx, id: string, done: boolean): void {
    this.db.prepare('UPDATE tasks SET done = ? WHERE tenant_id = ? AND id = ?')
      .run(done ? 1 : 0, ctx.tenantId, id);
    this.emit(ctx.tenantId, 'task.changed', { id });
  }

  /* ---- flow defs and runs ---- */
  upsertFlowDef(tenantId: string, def: FlowDef): void {
    this.db.prepare(`INSERT INTO flow_defs (flow_id, version, tenant_id, title, def, enabled, created_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(flow_id, version, tenant_id) DO UPDATE SET def = excluded.def, enabled = excluded.enabled`)
      .run(def.id, def.version, tenantId, def.title, JSON.stringify(def), def.enabled ? 1 : 0,
        new Date().toISOString());
  }
  flowDef(ctx: Ctx, flowId: string): FlowDef | null {
    const row = this.db.prepare(
      'SELECT def, enabled FROM flow_defs WHERE tenant_id = ? AND flow_id = ? ORDER BY version DESC LIMIT 1')
      .get(ctx.tenantId, flowId) as any;
    if (!row) return null;
    const def = JSON.parse(row.def) as FlowDef;
    def.enabled = !!row.enabled;
    return def;
  }
  flowDefs(ctx: Ctx): FlowDef[] {
    return (this.db.prepare(
      'SELECT def FROM flow_defs WHERE tenant_id = ? ORDER BY flow_id, version')
      .all(ctx.tenantId) as any[]).map(r => JSON.parse(r.def) as FlowDef);
  }
  insertFlowRun(r: FlowRun): void {
    this.db.prepare(`INSERT INTO flow_runs (id, tenant_id, flow_id, flow_version, candidate_id,
      actor_role, status, current_step, step_states, retries, error, trace, tool_calls, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(r.id, r.tenantId, r.flowId, r.flowVersion, r.candidateId, r.actorRole, r.status,
        r.currentStep, JSON.stringify(r.stepStates), JSON.stringify(r.retries), r.error,
        JSON.stringify(r.trace), JSON.stringify(r.toolCalls), r.createdAt);
  }
  flowRun(ctx: Ctx, id: string): FlowRun | null {
    const row = this.db.prepare('SELECT * FROM flow_runs WHERE tenant_id = ? AND id = ?')
      .get(ctx.tenantId, id) as any;
    return row ? rowToFlowRun(row) : null;
  }
  updateFlowRun(ctx: Ctx, id: string, patch: Partial<FlowRun>): void {
    const sets: string[] = []; const vals: unknown[] = [];
    const map: Record<string, string> = {
      status: 'status', currentStep: 'current_step', error: 'error',
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) { sets.push(`${col} = ?`); vals.push((patch as Record<string, unknown>)[k]); }
    }
    for (const [k, col] of Object.entries({
      stepStates: 'step_states', retries: 'retries', trace: 'trace', toolCalls: 'tool_calls',
    })) {
      if (k in patch) { sets.push(`${col} = ?`); vals.push(JSON.stringify((patch as Record<string, unknown>)[k])); }
    }
    if (!sets.length) return;
    this.db.prepare(`UPDATE flow_runs SET ${sets.join(', ')} WHERE tenant_id = ? AND id = ?`)
      .run(...(vals as any), ctx.tenantId, id);
  }
  flowRuns(ctx: Ctx, candidateId?: string): FlowRun[] {
    const rows = candidateId
      ? this.db.prepare('SELECT * FROM flow_runs WHERE tenant_id = ? AND candidate_id = ? ORDER BY created_at')
          .all(ctx.tenantId, candidateId) as any[]
      : this.db.prepare('SELECT * FROM flow_runs WHERE tenant_id = ? ORDER BY created_at')
          .all(ctx.tenantId) as any[];
    return rows.map(rowToFlowRun);
  }

  /* ---- entitlements, usage, prompts ---- */
  setEntitlement(tenantId: string, module: string, enabled: boolean): void {
    this.db.prepare(`INSERT INTO entitlements (tenant_id, module, enabled) VALUES (?,?,?)
      ON CONFLICT(tenant_id, module) DO UPDATE SET enabled = excluded.enabled`)
      .run(tenantId, module, enabled ? 1 : 0);
    this.emit(tenantId, 'entitlement.changed', { module, enabled });
  }
  entitlements(tenantId: string): ModuleEntitlement[] {
    return (this.db.prepare('SELECT * FROM entitlements WHERE tenant_id = ?')
      .all(tenantId) as any[]).map(r => ({ tenantId: r.tenant_id, module: r.module, enabled: !!r.enabled }));
  }
  recordUsage(m: UsageMeter): void {
    this.db.prepare('INSERT INTO usage_meters (id, tenant_id, kind, quantity, ref_id, ts) VALUES (?,?,?,?,?,?)')
      .run(m.id, m.tenantId, m.kind, m.quantity, m.refId, m.ts);
  }
  usage(tenantId: string): Array<{ kind: string; total: number }> {
    return this.db.prepare(
      'SELECT kind, SUM(quantity) AS total FROM usage_meters WHERE tenant_id = ? GROUP BY kind')
      .all(tenantId) as unknown as Array<{ kind: string; total: number }>;
  }
  upsertPrompt(flowId: string, agent: string, version: number, body: string): void {
    this.db.prepare(`INSERT INTO prompts (flow_id, agent, version, body, created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(flow_id, agent, version) DO UPDATE SET body = excluded.body`)
      .run(flowId, agent, version, body, new Date().toISOString());
  }
  prompt(flowId: string, agent: string, version: number): string | null {
    const row = this.db.prepare(
      'SELECT body FROM prompts WHERE flow_id = ? AND agent = ? AND version = ?')
      .get(flowId, agent, version) as any;
    return row ? row.body as string : null;
  }
}

/* ---- row mappers ---- */
function rowToUser(r: any): User {
  return {
    id: r.id, tenantId: r.tenant_id, email: r.email, passwordHash: r.password_hash,
    role: r.role, displayName: r.display_name, createdAt: r.created_at,
  };
}
function rowToCandidate(r: any): Candidate {
  return {
    id: r.id, tenantId: r.tenant_id, userId: r.user_id, name: r.name,
    targetRole: r.target_role, targetCompany: r.target_company,
    employer: r.employer, tenure: r.tenure,
    cvTenureStart: r.cv_tenure_start, cvTenureEnd: r.cv_tenure_end,
    stage: r.stage, parked: !!r.parked, linkedinStatus: r.linkedin_status,
    currentCompensation: r.current_compensation, compExpectations: r.comp_expectations,
    noticePeriod: r.notice_period, motivation: r.motivation, createdAt: r.created_at,
  };
}
function rowToConsent(r: any): ConsentRecord {
  return {
    id: r.id, tenantId: r.tenant_id, candidateId: r.candidate_id, sessionId: r.session_id,
    scope: r.scope, grantedAt: r.granted_at, withdrawnAt: r.withdrawn_at,
    retentionPolicy: r.retention_policy, createdAt: r.created_at,
  };
}
function rowToSession(r: any): InterviewSession {
  return {
    id: r.id, tenantId: r.tenant_id, candidateId: r.candidate_id, flowRunId: r.flow_run_id,
    mode: r.mode, status: r.status, date: r.date, duration: r.duration,
    star: r.star ? JSON.parse(r.star) : null,
    targets: { S: 15, T: 10, A: 50, R: 25 },
    ownership: r.ownership, trailing: r.trailing,
    transcript: JSON.parse(r.transcript), debrief: r.debrief,
    consentId: r.consent_id, createdAt: r.created_at,
  };
}
function rowToFlag(r: any): Flag {
  return {
    id: r.id, tenantId: r.tenant_id, candidateId: r.candidate_id, type: r.type,
    status: r.status, title: r.title, body: r.body, quote: r.quote,
    sourceRunId: r.source_run_id, createdAt: r.created_at,
  };
}
function rowToArtifact(r: any): Artifact {
  return {
    id: r.id, tenantId: r.tenant_id, candidateId: r.candidate_id, kind: r.kind,
    title: r.title, quarantine: r.quarantine, fields: JSON.parse(r.fields),
    sanitizedText: r.sanitized_text, content: r.content,
    injectionAttempts: r.injection_attempts, createdBy: r.created_by, createdAt: r.created_at,
  };
}
function rowToTask(r: any): CandidateTask {
  return {
    id: r.id, tenantId: r.tenant_id, candidateId: r.candidate_id, type: r.type,
    done: !!r.done, source: r.source, title: r.title, body: r.body,
    flagId: r.flag_id, createdAt: r.created_at,
  };
}
function rowToFlowRun(r: any): FlowRun {
  return {
    id: r.id, tenantId: r.tenant_id, flowId: r.flow_id, flowVersion: r.flow_version,
    candidateId: r.candidate_id, actorRole: r.actor_role, status: r.status,
    currentStep: r.current_step, stepStates: JSON.parse(r.step_states),
    retries: JSON.parse(r.retries), error: r.error, trace: JSON.parse(r.trace),
    toolCalls: JSON.parse(r.tool_calls), createdAt: r.created_at,
  };
}
