# Impact Analysis 0027 — Semantic Review V6 runtime selection

## Change

Make V6 selectable by the existing `AI诊断` composition root without adding a
route, service, checker authority or UI control. Selection remains server-side,
owner-scoped and fail-closed. The default is `off`; migration `051` must be
explicitly declared ready before V6 can be selected.

## Authorities affected

- Runtime selection: moves from an inline conditional in composition to one
  authoritative selector in `lib/grants/server/config.ts`.
- Semantic content: remains owned by the existing semantic checker.
- Evidence/image admission: remains owned by `GrantModelDataGateway`.
- Retry/call budget: remains owned by the V6 aggregate executor.
- Persistence: remains owned by `GrantDiagnosticRepository`.

## Compatibility and rollback

When V6 is not selected, the established hierarchical/V3/V2 precedence is
unchanged. Setting `GRANT_SEMANTIC_REVIEW_V6_MODE=off` is an immediate rollback
to that established path. No persisted V5/V3/V2 data is migrated or deleted.

## Risks and controls

- Accidental paid traffic: default-off plus required database schema `051`.
- Split-brain routing: the API route never reads a V6 flag; composition calls
  the sole selector once.
- Partial V6 execution: revision-bound checkpoints use existing repository
  ports and do not publish Findings until the atomic V6 save succeeds.
- Existing behavior regression: selector contract tests cover V2, V3,
  hierarchical fallback and V6 precedence.

## Verification boundary

This step proves code-level selection and pipeline connectivity only. It does
not enable a production cohort and therefore cannot claim user-visible V6
behavior.
