# Impact Analysis: Grant document and revision foundation

## Problem and Evidence

- Observed behavior: the grant bounded context has governance and spike results,
  but no executable canonical document or revision contract.
- Reproduction or production evidence: no `lib/grants` product implementation
  or grant database tables exist.
- Root cause: product implementation was intentionally blocked until the four
  technical spikes completed.
- Why this is not only a symptom: editor, diagnostics, patching, evidence and
  export all require the same stable document and revision authority.

## Ownership

- Current authoritative owner: none; only the governance contract exists.
- Owner after the change: Grant Domain owns structure; Revision Service owns
  current-revision arbitration; Template Snapshot is immutable; Audit Repository
  records committed effects.
- Downstream consumers: future grant editor, diagnostics, patching, evidence,
  recheck and export application services.
- Decisions downstream modules must not reinterpret: IDs, node order, current
  revision, template version, content hash and commit outcome.

## Scope

- Files/modules expected to change: new `lib/grants/domain`, `application`,
  `ports`, test-only in-memory infrastructure, one additive SQL migration and a
  contract-test script.
- User-visible behavior that must change: none in this PR; it is a disabled
  foundation milestone.
- Existing behavior that must remain unchanged: chat, Document V2, research
  exploration, uploads, literature, auth and all deployed routes.
- Data/schema impact: additive grant-only tables and service-role RPCs; no old
  table is changed.
- Security/privacy impact: grant rows are owner-scoped and inaccessible to
  browser roles; immutable revisions and audit events are append-only.

## Options

- Chosen approach: strict domain contracts, application-owned IDs, repository
  port, atomic compare-and-swap, immutable template/revision/audit records.
- Rejected alternatives: storing one mutable JSON document; reusing Document V2
  jobs; allowing UI/API to update rows directly.
- Why the change does not create parallel authority: this is the first grant
  implementation and is isolated from existing document-generation contexts.
- Code or path that will be removed: none.

## Migration and Rollback

- Compatibility period: additive and disabled until later user-facing phases.
- Removal condition: not applicable.
- Feature flag: no route consumes the data yet; planned
  `GRANT_WORKSPACE_ENABLED` remains absent/off.
- Rollback behavior: stop calling grant RPCs; existing systems are unaffected.
- Data readability after rollback: additive tables remain readable by
  service-role tooling; no destructive down migration is included.

## Verification

- Contract test: create, immutable snapshot, valid revision, stale revision,
  simultaneous writers, malformed canonical structure and deterministic hash.
- Architecture check: `npm run check:grant-architecture`.
- Regression scenarios: typecheck plus existing Document V2 job-binding and
  runtime tests because no shared implementation is changed.
- Real user-path check: not applicable until the editor route exists.
- Real file/output inspection: not applicable; export is not part of this step.
- What cannot yet be verified: production Postgres RPC behavior until the
  additive migration is explicitly applied to a test/production database.
