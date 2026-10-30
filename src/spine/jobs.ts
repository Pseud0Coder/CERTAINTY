/* Background jobs (ADR-0028). A screening can take a minute when a model is
   involved, which is too long to hold one HTTP request open (hosts time out,
   and the person sees nothing). The request now starts a job and returns at
   once; the page polls the job for its step and, when done, for the result.

   In memory by design: one instance, short-lived work, and the finished
   screening is stored in the database like any other. A restart loses a job
   that was running, and the client says so and offers a retry. */
import { randomUUID } from 'node:crypto';

export type JobStatus = 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  tenantId: string;
  userId: string;
  kind: string;
  status: JobStatus;
  /* Index into `steps` of the step in progress, and the step names. */
  step: number;
  steps: string[];
  resultId: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface JobView {
  id: string; status: JobStatus; step: number; steps: string[];
  stepLabel: string; resultId: string | null; error: string | null; elapsedMs: number;
}

export class JobBusyError extends Error {
  constructor() { super('busy'); }
}

const KEEP_MS = 60 * 60 * 1000;

export class JobRegistry {
  private jobs = new Map<string, Job>();
  private limit: number;
  private now: () => number;

  constructor(opts: { concurrency?: number; now?: () => number } = {}) {
    this.limit = Math.max(1, opts.concurrency ?? 3);
    this.now = opts.now ?? Date.now;
  }

  private sweep(): void {
    const cutoff = this.now() - KEEP_MS;
    for (const [id, j] of this.jobs) if (j.finishedAt !== null && j.finishedAt < cutoff) this.jobs.delete(id);
  }

  running(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.status === 'running') n++;
    return n;
  }

  runningFor(userId: string): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.status === 'running' && j.userId === userId) n++;
    return n;
  }

  /* Starts `work` and returns the job. `work` receives a function that moves
     the job to a named step and returns the id of what it produced. Throws
     JobBusyError when the instance is already at its concurrency limit. */
  start(
    meta: { tenantId: string; userId: string; kind: string; steps: string[] },
    work: (advance: (step: string) => void) => Promise<string>,
  ): Job {
    this.sweep();
    if (this.running() >= this.limit) throw new JobBusyError();
    const job: Job = {
      id: randomUUID(), tenantId: meta.tenantId, userId: meta.userId, kind: meta.kind,
      status: 'running', step: 0, steps: meta.steps, resultId: null, error: null,
      startedAt: this.now(), finishedAt: null,
    };
    this.jobs.set(job.id, job);
    const advance = (step: string) => {
      const i = job.steps.indexOf(step);
      if (i >= 0 && i > job.step) job.step = i;
    };
    work(advance).then(
      resultId => { job.status = 'done'; job.resultId = resultId; job.step = job.steps.length - 1; job.finishedAt = this.now(); },
      err => {
        const code = (err as { code?: unknown } | null)?.code;
        job.status = 'failed';
        job.error = typeof code === 'string' ? code : 'screening_failed';
        job.finishedAt = this.now();
      },
    );
    return job;
  }

  /* A job is visible only to the user who started it, in their tenant. */
  view(tenantId: string, userId: string, id: string): JobView | null {
    const j = this.jobs.get(id);
    if (!j || j.tenantId !== tenantId || j.userId !== userId) return null;
    return {
      id: j.id, status: j.status, step: j.step, steps: j.steps, stepLabel: j.steps[j.step] ?? '',
      resultId: j.resultId, error: j.error, elapsedMs: (j.finishedAt ?? this.now()) - j.startedAt,
    };
  }
}
