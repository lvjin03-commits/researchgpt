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
request. A protected scheduled request to
`/api/internal/document-v2-worker` atomically claims one queued job, generates
at most one planned component, saves the checkpoint, releases the lease, and
continues on a later tick. The final tick renders and validates the DOCX and
stores it in the existing authenticated download channel.

Required server-only environment variables:

- `SUPABASE_SERVICE_ROLE_KEY` for claiming jobs and storing artifacts;
- `CRON_SECRET` for the internal worker endpoint;
- `OPENAI_API_KEY` for structured component and final figure generation;
- optional `OPENAI_DOCUMENT_MODEL` and `OPENAI_IMAGE_MODEL` overrides.

Migration `014_document_v2_worker.sql` installs the service-role-only atomic
claim function. The five-minute Vercel schedule advances one component per
invocation. The user-facing creation route remains behind the existing rollout
switch and is not changed by this worker step.

## Step 10 creation boundary

`POST /api/document-v2/jobs` is the authenticated creation boundary. It does
not render a document inside the request. It performs, in order:

1. semantic understanding of the complete user instruction;
2. compatible template resolution;
3. AI outline planning within the template component limits;
4. deterministic component-key and length allocation;
5. durable job creation for the background worker.

The caller supplies a UUID `idempotencyKey`. That key becomes both the
document request ID and job ID. Repeating the same request returns the existing
job before any model call, preventing duplicate planning, generation, and
charges. The response contains only the public job snapshot; prompts, plans,
content, references, and checkpoints remain server-side.

This endpoint remains protected by `DOCUMENT_V2_RUNTIME_ENABLED`. Step 10 does
not connect the legacy chat route or switch production traffic.

Migration `013_document_v2_runtime.sql` was applied to the production
ResearchGPT Supabase project on 2026-07-28 after a dry run confirmed it was the
only pending migration. Remote migration history now matches local versions
001 through 013. The production feature flag remains disabled.

## Not yet connected

- production chat route;
- chat intent handoff to the creation route;
- placement of the monitor in the production chat transcript.
