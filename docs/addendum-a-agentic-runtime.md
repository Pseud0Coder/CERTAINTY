# ADDENDUM A - AGENTIC RUNTIME
Expands and replaces section 9 of the master build prompt. Binding.

A0. The governing principle

Agents produce state. Dashboards render state. No agent ever renders UI,
holds a UI session, or mutates the interface. Every agent output lands in
the spine as structured data (flags, metrics, artifacts, tasks, events)
and the dashboards subscribe to the event bus. An agent crash degrades
intelligence, never the dashboard. The recruiter opens the pipeline and
it always renders, because the pipeline is code, not a model.

A1. Two agent classes

Session agents (interactive, real time):
- Resume Studio interviewer, Interview Practice / Screener interviewer.
- One active session agent per candidate per flow. Enforced by the
  runtime, not the prompt.
- Chat and voice surfaces. Streaming token output to chat, streaming
  speech to voice.
- Turn state machine: idle, listening, transcribing, thinking, speaking.
  Barge-in during speaking returns to listening. No turn may exceed
  15 seconds of speech. Numbers and metrics heard in voice are confirmed
  back before use. Garbled audio is re-asked, never guessed.
- The handoff protocol is runtime behavior: on session completion the
  agent stops speaking entirely and the deliverable renders as a
  copyable text block. There is no narration path.

Pipeline agents (event-triggered, background):
- Ingestion analyzer: fires on artifact ingest. Runs extraction and
  writes structured fields, logs injection attempts, proposes flags.
- Session evaluator: fires on session end. Writes STAR metrics, ownership
  ratio, trailing counts, transcript annotations, proposed flags.
- Conflict detector: fires on linkedin_snapshot ingest or spine field
  change. Writes source_conflict flags with both versions stated.
- Gap projector: fires on flag changes. Writes candidate-facing tasks
  (severity stripped, task phrasing) into the candidate projection.
- Stage advisor: fires on verified session completion. Writes a stage
  suggestion. Never advances a stage. Humans advance stages.
- Submission composer: fires on recruiter request, gated 4 of 4 sources.
  Writes deliverable artifacts plus the deterministic QA checklist.

A2. Dashboard surface to agent mapping

Surface                  Produced by            Trigger            Output
Pipeline cards           spine (human)          recruiter action   state
Stage suggestion chip    stage advisor          session complete   suggestion
Insights tab             session evaluator      session complete   metrics
Transcript annotations   session evaluator      session complete   annotations
Gap flags tab            ingestion analyzer,    ingest, session    flags
                         conflict detector      end
Notes to-verify list     conflict detector      conflict found     entries
My Gaps (candidate)      gap projector          flag change        tasks
Resume Studio session       session agent          candidate action   live
Interview practice       session agent          candidate action   live
LinkedIn sections        generation agent       candidate request  artifacts
Submission outputs       submission composer    recruiter request  artifacts

Any surface not in this table is deterministic code with no agent.

A3. Agent runner specification

Every agent run executes in a sandboxed request context containing:
- tenant_id, candidate_id, flow_run_id, acting role
- a projection of the spine scoped to that role (L2 from the master
  prompt: the agent physically cannot read beyond its role scope)
- its server-custody system prompt, versioned in the database
- its tool allowlist
- its model config and token budget

The runner enforces: timeouts, budgets, single-write semantics per tool
call, and structured logging of every turn into the trace store. Agent
runs are replayable from the trace store.

A4. Tool layer

Agents act only through registered tools. No raw SQL, no file system,
no outbound network except the sandboxed LinkedIn reader skill.
Core tools:
- read_spine (projection-scoped)
- write_artifact, write_flag, write_task, write_metrics
- suggest_stage (writes a suggestion only)
- emit_event
Tool calls inherit the acting role's RBAC projection. A candidate-side
agent calling read_spine gets the candidate projection, full stop.
Tool calls are idempotent keyed by run_id plus step plus sequence.
Unknown or unlisted tool calls fail closed and are logged.

A5. Orchestration

FlowRun is a state machine in code. Agents execute steps; they never
decide transitions alone. A session agent may declare a step complete
(the bullet count is met, the candidate has no more areas), and the
runtime validates the declaration against the flow contract before
transitioning. On validation failure the run stays in step and the
event is logged. Retries are bounded at 2, then the step fails into a
visible error state with a human resume path.

A6. Memory rules

- Session context is scoped to one candidate, one flow run. No
  cross-candidate, cross-tenant, or cross-session memory. Ever.
- The only long-term memory is the spine. Context assembly reads
  projections of the spine, never raw ingested documents (L1).
- Conversation history within a run is capped and summarized by code,
  not by the model, at a fixed turn budget.

A7. Output contracts

Every agent output passes a contract layer before it can touch the
spine: schema validation first, then deterministic post-processors:
em dash linter, string scrubber, compensation-field scrubber on
anything client-facing, date consistency check against spine fields.
Free text may flow only to chat and voice surfaces. Structured output
only into the spine. A failed contract is a run error, not a warning.

A8. Model routing and budgets

Model choice is configured per flow step, per tenant. Default routing:
extraction and probing steps on the cheaper tier, evaluation and
synthesis steps on the stronger tier. Every run carries a token and
cost budget; exceeding it kills the run with a visible failure state.
Per-tenant usage meters feed billing. Voice sessions carry an
additional wall-clock budget.

A9. Human gates (unchanged from the master prompt, restated because
agents will bump into them)

- Consent record before any verified voice capture.
- Stage advances are human actions. Agents suggest only.
- Flag actions are recruiter clicks. Agents propose only.
- Submission generation is recruiter-initiated.
These gates are enforced in the runtime layer, not in prompts.

A10. Observability and evals

- Every agent turn is traced: inputs (projections, not raw docs),
  tool calls, outputs, model, latency, cost. Traces are per-tenant.
- Golden transcript evals for the interview and Interviewer session agents
  run in CI: a fixed set of candidate transcripts must produce
  expected metrics, flags, and handoff blocks. Regression in a golden
  transcript blocks release, same severity as a failing unit test.
- The injection red-team corpus (master prompt, P2) runs against the
  full agent stack, not just ingestion.

A11. What the agentic layer never does

- Never renders or controls UI.
- Never advances a stage, records without consent, or fires a flag
  action without a human click.
- Never reads beyond its role projection or another tenant's data.
- Never sees raw ingested document text.
- Never keeps memory across candidates or sessions.
- Never calls a tool outside its allowlist.
- Never streams unvalidated output into the spine.
