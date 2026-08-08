# Impact Analysis 0003: Diagnostics and Cross-Revision Anchors

- Status: accepted for PR3 implementation
- Date: 2026-08-07
- Scope: Grant bounded context only

## Intended Effect

An authenticated user can run the registered grant checkers against an
immutable document revision. Every resulting Finding identifies its checker,
input revision and source node, or explicitly records that it could not be
located. When the document changes, the system conservatively relocates source
anchors and never guesses through ambiguous drift.

## Authority and Data Flow

```text
Grant API
  -> Grant Diagnostic Service
  -> registered Checkers (conclusions only)
  -> Diagnostic Assembler (identity, anchors, conflicts)
  -> Diagnostic Repository (atomic persistence)
```

- Checkers do not persist state or assign database IDs.
- The Diagnostic Assembler owns Finding identity and conflict records but does
  not reinterpret checker conclusions.
- Stable node IDs and Revision Service snapshots remain authoritative.
- Fuzzy anchor scores are evidence for a conservative decision, never write
  authority.

## Modules Changed

- `lib/grants/domain`: diagnostic, Finding, conflict and anchor contracts.
- `lib/grants/diagnostics`: checker runner, assembler and relocalization.
- `lib/grants/application`: diagnostic execution/read use cases.
- `lib/grants/ports`: diagnostic persistence capability.
- `lib/grants/infrastructure`: memory and Supabase adapters.
- `app/api/grants`: authenticated diagnostic execution/read boundary.
- `supabase/migrations`: additive diagnostic tables and owner-scoped RPCs.

## Existing Product Impact

- Canonical document writes still go only through Revision Service.
- Chat, Document V2, literature, STORM, export and existing grant autosave are
  unchanged.
- No model provider or AI repair path is introduced.
- The existing `GRANT_WORKSPACE_ENABLED` capability gate covers the new API.

## Failure and Recovery

- A checker failure is recorded as a failed run and does not invalidate other
  successful checker results.
- Persistence is atomic for runs, Findings and conflicts.
- Ambiguous or low-confidence relocation remains visible as `ambiguous`,
  `unable_to_match` or `human_review_required`.
- Re-running diagnostics creates a new immutable execution; it does not mutate
  historical Findings.

## Verification

1. Contract tests cover located and explicitly unlocated Findings.
2. Synthetic checker disagreement produces a retained conflict.
3. The eight accepted anchor-drift cases preserve ADR-0005 decisions.
4. PostgreSQL persistence is atomic and owner-scoped.
5. The authenticated diagnostic API path is exercised before exposure.

## Rollback

Turn off `GRANT_WORKSPACE_ENABLED`. Diagnostic records remain isolated and
canonical revisions remain readable. No rollback changes document content.
