/* Model provider layer (ADR-0005, extended by ADR-0012).

   The provider is the only place in the codebase that talks to a model. It
   returns structured data or nothing: there is no free-text path out of
   here into the spine. Every caller keeps its deterministic scripted
   implementation and uses that when the provider yields null, so an
   unconfigured, throttled, slow or malformed model degrades intelligence
   and never breaks a flow (A0).

   Custody (L3): prompt bodies arrive from the server-side registry and are
   sent to the model endpoint only. They are never returned to a caller,
   never logged, and never placed in a trace entry. Traces record the prompt
   length and version, never the body.

   Quarantine (L1): callers pass sanitized evidence only. This layer does
   not read artifacts and cannot reach raw candidate text. */

export type ModelTier = 'cheap' | 'strong';

/* A JSON Schema subset: object schemas with `strict` semantics. OpenRouter
   passes these to the upstream provider for constrained decoding. */
export type JsonSchema = Record<string, unknown>;

export interface LlmRequest {
  /* The custody prompt body. Never logged. */
  system: string;
  /* Sanitized, structured evidence. Never raw artifact text. */
  user: string;
  /* Strict output schema. A response that does not satisfy it is discarded. */
  schema: JsonSchema;
  /* Schema name, used for the response_format envelope and for tracing. */
  schemaName: string;
  tier: ModelTier;
  /* Deterministic sampling for repeatable evals (A10). */
  seed?: number;
  maxTokens?: number;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export interface LlmResult<T> {
  value: T;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  /* Resolves to null on any failure: no key, transport error, timeout,
     truncation, unparseable body or schema mismatch. Callers fall back to
     their scripted implementation. Never throws. */
  complete<T>(req: LlmRequest): Promise<LlmResult<T> | null>;
}

/* ---------------------------------------------------------------------- */

/* GLM 5.3 Flash reasons before it answers and the endpoint refuses to let
   reasoning be disabled, so the completion budget has to cover a reasoning
   block plus the structured answer. Measured reasoning on these prompts
   runs a few hundred tokens; these ceilings leave generous headroom
   because a truncated response is discarded entirely. */
const MAX_TOKENS: Record<ModelTier, number> = { cheap: 3000, strong: 6000 };

/* Reasoning models are slow. These bound the wait so a hung upstream
   cannot hold a flow step open. */
const TIMEOUT_MS: Record<ModelTier, number> = { cheap: 45_000, strong: 90_000 };

/* Transport-level retries, distinct from the engine's bounded step retries
   (A5). Only idempotent, transient conditions are retried. */
const TRANSPORT_ATTEMPTS = 2;
const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export const OPENROUTER_MODEL = 'z-ai/glm-5.3-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterChoice {
  finish_reason?: string;
  message?: { content?: string | null; refusal?: string | null };
}
interface OpenRouterBody {
  choices?: OpenRouterChoice[];
  error?: { message?: string; code?: number };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  /* Attribution headers OpenRouter uses for its dashboards. Optional. */
  referer?: string;
  title?: string;
  /* Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /* Structured, body-free diagnostics. Never receives prompt text. */
  onDiagnostic?: (event: string, detail: string) => void;
}

export function openRouterProvider(opts: OpenRouterOptions): LlmProvider {
  const model = opts.model ?? OPENROUTER_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;
  const note = opts.onDiagnostic ?? ((): void => {});

  async function attempt<T>(req: LlmRequest): Promise<{ result: LlmResult<T> | null; retry: boolean }> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.tier === 'strong' ? TIMEOUT_MS.strong : TIMEOUT_MS.cheap);
    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (opts.referer) headers['HTTP-Referer'] = opts.referer;
      if (opts.title) headers['X-Title'] = opts.title;

      const res = await doFetch(OPENROUTER_URL, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model,
          /* Temperature 0 plus a seed is the closest this endpoint offers to
             a repeatable decode, which the golden transcript evals want. */
          temperature: 0,
          seed: req.seed ?? 7,
          max_tokens: req.maxTokens ?? MAX_TOKENS[req.tier],
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: req.schemaName, strict: true, schema: req.schema },
          },
        }),
      });

      if (!res.ok) {
        /* Body text can carry an upstream error message but never prompt
           text, so the status and code alone are recorded. */
        note('http_error', `${res.status}:${req.schemaName}`);
        return { result: null, retry: RETRY_STATUS.has(res.status) };
      }

      const body = await res.json() as OpenRouterBody;
      if (body.error) {
        note('api_error', `${body.error.code ?? 'unknown'}:${req.schemaName}`);
        return { result: null, retry: RETRY_STATUS.has(Number(body.error.code)) };
      }

      const choice = body.choices?.[0];
      if (choice?.finish_reason === 'length') {
        /* Reasoning consumed the budget. A partial JSON body is not
           trustworthy structured output, so it is discarded outright. */
        note('truncated', req.schemaName);
        return { result: null, retry: false };
      }
      const content = choice?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        note('empty_content', `${choice?.finish_reason ?? 'none'}:${req.schemaName}`);
        return { result: null, retry: false };
      }

      let value: T;
      try {
        value = JSON.parse(content) as T;
      } catch {
        note('unparseable', req.schemaName);
        return { result: null, retry: false };
      }

      const u = body.usage ?? {};
      return {
        result: {
          value,
          model,
          usage: {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
            costUsd: u.cost ?? 0,
          },
          latencyMs: Date.now() - started,
        },
        retry: false,
      };
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      note(aborted ? 'timeout' : 'transport_error', req.schemaName);
      return { result: null, retry: !aborted };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: `openrouter:${model}`,
    async complete<T>(req: LlmRequest): Promise<LlmResult<T> | null> {
      for (let i = 0; i < TRANSPORT_ATTEMPTS; i++) {
        const { result, retry } = await attempt<T>(req);
        if (result) return result;
        if (!retry) return null;
      }
      return null;
    },
  };
}

/* The fail-closed provider (ADR-0005). Selected whenever no key is
   configured, so every caller runs its scripted implementation. */
export const nullProvider: LlmProvider = {
  name: 'scripted',
  async complete(): Promise<null> { return null; },
};

/* Environment selection. `CERTAINTY_LLM=off` forces the scripted path even
   when a key is present, which is how the test suite and the deterministic
   demo stay repeatable. */
export function providerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  onDiagnostic?: (event: string, detail: string) => void,
): LlmProvider {
  if (env.CERTAINTY_LLM === 'off') return nullProvider;
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return nullProvider;
  return openRouterProvider({
    apiKey,
    model: env.CERTAINTY_MODEL?.trim() || OPENROUTER_MODEL,
    referer: 'https://certainty.local',
    title: 'Certainty',
    onDiagnostic,
  });
}
