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

Migration `013_document_v2_runtime.sql` was applied to the production
ResearchGPT Supabase project on 2026-07-28 after a dry run confirmed it was the
only pending migration. Remote migration history now matches local versions
001 through 013. The production feature flag remains disabled.

## Not yet connected

- production chat route;
- background worker/queue;
- download artifact service;
- document creation route and chat intent handoff;
- placement of the monitor in the production chat transcript.
