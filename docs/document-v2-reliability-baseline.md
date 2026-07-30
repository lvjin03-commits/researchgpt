# Document V2 reliability baseline

This file freezes the migration boundary for the durable document pipeline.
It is intentionally narrower than the full target architecture.

## Current authoritative owners

| Decision | Authoritative owner |
| --- | --- |
| User intent and source scope | chat intent router |
| Text provider and model | frozen `checkpoint.textExecution` |
| Template and planned headings | document plan |
| Component semantics | selected text model |
| IDs, revisions, numbering and storage | application runtime |
| Word formatting | DOCX renderer |
| Current execution state | Document V2 job runtime |

Downstream code must not reinterpret an upstream decision. In particular, the
worker must not replace a missing frozen provider with a default provider.

## PR 1 safety boundary

The first reliability change keeps the existing Job execution model while:

- separating raw-response persistence from schema acceptance;
- treating an expired provider request as an unknown outcome;
- reusing a durable raw response without another provider call;
- requiring every execution-ledger update to affect the expected row;
- preserving semantic array order in canonical hashes;
- merging explicitly verified references with evidence-backed references;
- reusing the dispatch claim instead of acquiring the Job lease twice;
- constructing the OpenAI image client only when an image is actually needed.

This release does not introduce a parallel Step executor.

## Required regression scenarios

1. A schema-invalid response is never stored as `succeeded`.
2. A `raw_saved` response resumes from parsing without a provider call.
3. An expired `request_started` execution becomes `unknown_outcome`.
4. A missing frozen text profile never falls back to OpenAI.
5. A dispatch-claimed Job is not leased again by `JobService.run`.
6. Verified references remain available even without evidence excerpts.
7. A DeepSeek no-image job does not require an OpenAI client.
8. Canonically equal objects produce the same fingerprint while ordered arrays
   retain their order.

## PR 2A impact analysis

The next core-model change may add durable Steps for finalization only:

```text
legacy generation
-> one-way handoff
-> document_assembly
-> docx_rendering
-> validate_and_publish
```

Before implementation it must define:

- one frozen finalization mode per Job;
- one unique root finalization Step;
- Step as the execution source of truth and Job as a derived summary;
- database fencing for every published result;
- immutable temporary object-storage paths;
- transactional Step completion and next-Outbox creation;
- a minimal reference-only manifest with no image Base64;
- migration, rollback and deletion conditions for the legacy finalizer.

The legacy finalizer and Step finalizer must never be authoritative for the same
Job.

## Effect-first release gate

Code-level checks:

```text
npm run typecheck
npm run test:document-v2-generation
npm run test:document-v2-orchestrator
npm run test:document-v2-runtime
npm run test:document-v2-docx
npm run check:document-architecture
```

Production readiness additionally requires:

1. apply the corresponding database migration;
2. create one DeepSeek no-image job and one authorized image job;
3. inspect model/provider/usage events;
4. download the resulting DOCX;
5. open or render every page and inspect structure and layout;
6. confirm the request did not enter a legacy chat-export path.
