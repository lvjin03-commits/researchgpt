# ADR-0015: Semantic Diagnostic V3 contract and migration boundary

## Status

Accepted, 2026-08-09. Runtime wiring is implemented behind a default-off
rollout flag; production activation and signed-in effect verification are
pending.

## Context

The current strict semantic diagnostic contract produces a category, message,
recommendation, assessment and one section/node reference. A stronger NSFC
review prompt needs to distinguish the observable fact from the reason, retain
multiple cross-section locations, state evidence boundaries and record which
authorized Evidence Cards support a judgment. Changing only the prompt would
make the model output incompatible with existing validation and projections.

## Decision

- V3 replaces the semantic checker's content contract; it does not add another
  diagnostic route, button, worker, provider or persistence authority.
- Model output contains semantic content and supplied references only. Programs
  continue to own IDs, revisions, lifecycle, fingerprints, ordering, conflicts
  and persistence.
- Provider-facing V3 output has no optional properties. Absence is represented
  by JSON null or an empty required array.
- The primary location is singular. Related locations use the fixed roles
  `supporting_location`, `conflicting_location`, `upstream_dependency`,
  `downstream_dependency`, `comparison_location` and
  `missing_expected_location`.
- `actionability` is not severity or priority. Default presentation order is
  canonical section order, node order and occurrence order.
- `verified` Evidence Cards may support judgments only within their supported
  scope. `metadata_only` cards can establish record existence only.
- Stable identity excludes recommendation wording and possible consequences.
- V2 findings remain immutable audit records. They become superseded in the
  active projection only after a successful user-requested V3 run covers their
  scope.

## Consequences

The future implementation requires coordinated schema, gateway, assembler,
repository and UI changes, so it must proceed in staged PRs. Historical data is
not rewritten and no automatic model cost is incurred by deployment. Until the
V3 rollout gate passes, production continues to use the current V2 contract.
