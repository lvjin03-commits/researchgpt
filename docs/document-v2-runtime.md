# Document v2 Runtime and Observability

This document is authoritative for step 7 of the isolated document-v2
mainline.

## Purpose

The runtime makes a document job observable and recoverable without exposing
prompts, model responses, document text, or checkpoints to the browser.

## Ownership

| Concern | Owner |
|---|---|
| Content order and local retry | orchestrator |
| Durable job status and checkpoint | job repository |
| Single-worker execution | lease |
| User cancellation | job service |
| Resume boundary | last saved orchestration checkpoint |
| User-facing stage names | runtime contracts |
| Technical diagnostics | structured events |
| Display | progress component |

The runtime does not reinterpret the request, template, plan, content, images,
or final document.

## State machine

```text
queued -> running -> completed
                  -> failed -> paused/resume -> running
                  -> cancelling -> cancelled -> paused/resume -> running
```

A cancellation request is cooperative. It is checked before every component
and between finalization stages. Approved components remain in the checkpoint.

## Checkpoint boundary

The complete orchestration state is saved after every component. Resume never
regenerates approved components. A failed current component is reset to
`pending`; previously approved components remain immutable.

## Duplicate-execution protection

Every worker must acquire a time-limited lease. Another worker cannot execute
the same job while that lease is active. Every write also uses an optimistic
`revision`, so stale workers cannot overwrite a newer checkpoint.

## Event policy

Events contain:

- stage and public status;
- human-readable public message;
- component key and attempt when applicable;
- duration;
- stable error code and bounded technical message.

Events must not contain prompts, generated paragraphs, source text, image
bytes, access tokens, or the serialized checkpoint.

## Browser contract

The public snapshot deliberately removes the checkpoint. The UI shows a
plain-language stage, percentage, completed component count, cancel/resume
controls, and an expandable event timeline. Technical failure details remain
collapsed by default.

## Persistence

`DocumentJobRepository` is the only storage boundary. The in-memory
implementation is used for deterministic lifecycle tests. A production
Supabase implementation and authorized database migration remain required
before production integration.

## Step 8 production boundary

Step 8 adds:

- `SupabaseDocumentJobRepository`;
- migration `013_document_v2_runtime.sql`, including RLS, atomic event
  sequencing, optimistic revision writes, and atomic worker leases;
- authenticated, owner-scoped `GET` and `PATCH` task endpoints;
- a polling monitor with bounded reconnect backoff, hidden-tab throttling, and
  cancel/resume controls;
- the server-side `DOCUMENT_V2_RUNTIME_ENABLED` rollout switch.

## Production worker

The production executor is deliberately separate from the user-facing chat
request. A protected execution request atomically claims one queued job and
continuously advances ready components within a bounded wall-clock budget.
Every approved component is checkpointed immediately. The worker yields and
releases its lease only when the job completes, is cancelled, fails, or
approaches its execution deadline. The final phase renders and validates the
DOCX and stores it in the existing authenticated download channel.

Required server-only environment variables:

- `SUPABASE_SERVICE_ROLE_KEY` for claiming jobs and storing artifacts;
- `CRON_SECRET` for the internal worker endpoint;
- `OPENAI_API_KEY` for structured component and final figure generation;
- optional `OPENAI_DOCUMENT_MODEL`, `OPENAI_IMAGE_STANDARD_MODEL`, and
  `OPENAI_IMAGE_PREMIUM_MODEL` overrides. `OPENAI_IMAGE_MODEL` remains the
  general chat-image setting and is not the Document V2 execution profile.
- optional `DOCUMENT_V2_WORKER_BUDGET_MS` wall-clock budget (45 seconds by
  default, capped at 240 seconds).

`lib/document-v2-production/runtime-config.ts` is the single source of truth
for this contract. Public intake is allowed only when the public rollout flag
is enabled and every required worker variable is present and valid. New
deployments may use `DOCUMENT_V2_PUBLIC_ENABLED`; when it is absent, the legacy
`DOCUMENT_V2_RUNTIME_ENABLED` flag remains a compatibility fallback.

All immediate and continuation dispatches go through
`lib/document-v2-production/dispatch.ts`. A non-2xx worker response is a failed
dispatch even when `fetch()` itself resolves. Missing configuration returns
503, while an invalid caller credential returns 401. Dispatch failures never
delete the durable job or outbox entry.

The authenticated read-only probe is
`GET /api/internal/document-v2-worker/probe`. It checks configuration,
database access, migration 016's health RPC, and the export storage bucket. It
does not claim jobs or invoke a model.

Production rollout order:

1. deploy with public intake disabled;
2. apply all database migrations, including
   `016_document_v2_runtime_health.sql`;
3. configure the worker secret and remaining required variables;
4. call the authenticated probe;
5. run `npm run smoke:document-v2` with a dedicated test account;
6. open public intake only after the downloaded DOCX passes validation.

Migration `014_document_v2_worker.sql` installs the service-role-only atomic
claim function. Vercel Hobby permits only a daily cron, which is configured as
a deployment-safe fallback. Before production traffic is enabled, the project
must use a minute-level scheduler (Vercel Pro or an external/Supabase
scheduler) so queued components advance promptly. The user-facing creation
route remains behind the existing rollout switch and is not changed by this
worker step.

## Step 10 creation boundary

`POST /api/document-v2/jobs` is the authenticated intake boundary. It performs
only authentication, schema validation, idempotency lookup, and durable intake
creation before returning a public job snapshot. Understanding, template
resolution, evidence preparation, and planning run inside the worker and are
therefore observable and recoverable job stages.

The job insert and every later transition back to `queued` create a unique
transactional outbox record in the same database transaction. The API uses
Next.js `after()` to request immediate delivery after returning the job card.
An unfinished worker slice persists a continuation event and immediately
requests another worker invocation. Cron is only the recovery path.

The caller supplies a UUID `idempotencyKey`. That key becomes both the
document request ID and job ID. Repeating the same request returns the existing
job before any model call, preventing duplicate planning, generation, and
charges. The response contains only the public job snapshot; prompts, plans,
content, references, and checkpoints remain server-side.

This endpoint remains protected by `DOCUMENT_V2_RUNTIME_ENABLED`. Step 10 does
not connect the legacy chat route or switch production traffic.

## Evidence and reproducibility boundary

Verified citation metadata alone does not authorize a citation. Only evidence
items containing a verified reference, bounded excerpt, and optional
page/section locator enter the orchestration evidence bundle. A component sees
only evidence IDs assigned to it by the plan. Evidence text is explicitly
treated as untrusted data, never as model instructions.

Before content generation, the private checkpoint freezes model, prompt,
validator, renderer, template, and evidence versions together with a bounded
job budget. Model calls, repair attempts, and execution time are charged
against that budget. Exhaustion saves the checkpoint and changes the public
state to `budget_exhausted`.

Approved component outputs carry immutable revision metadata, input/output
hashes, and dependency versions. Revising an upstream component marks all
transitive dependents `stale` so they must be regenerated or revalidated.

Migration `013_document_v2_runtime.sql` was applied to the production
ResearchGPT Supabase project on 2026-07-28 after a dry run confirmed it was the
only pending migration. Remote migration history now matches local versions
001 through 013. The production feature flag remains disabled.

## Not yet connected

- production chat route;
- chat intent handoff to the creation route;
- placement of the monitor in the production chat transcript.
