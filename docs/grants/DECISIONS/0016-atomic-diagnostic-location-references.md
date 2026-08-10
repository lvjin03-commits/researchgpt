# ADR-0016: Atomic model-facing diagnostic location references

## Status

Accepted, 2026-08-10. Production rollout requires migration 046, deployment and
a new signed-in diagnostic run.

## Context

Semantic Diagnostic V3 exposed canonical `sectionId` and `nodeId` as two
independent provider-output fields. Production evidence showed GPT returning
nonexistent combinations even though the full canonical document was supplied.
Shortening both IDs independently would preserve the same composition error.

## Decision

- Each authorized canonical node receives one indivisible execution-local
  reference (`N1`, `N2`, ...).
- The mapping is created deterministically when model input is prepared and is
  reused unchanged by every provider attempt for that execution.
- The provider sees and returns only the atomic reference. It never creates or
  combines section/node identity.
- Programs map references back to canonical UUIDs before program validation,
  assembly, fingerprinting and persistence.
- Closed-set validation remains mandatory. Unknown primary references discard
  their Finding. Unknown related references are removed; a cross-section
  Finding without any surviving related location is discarded. Invalid
  Evidence Card references discard their Finding.
- If a non-empty provider response leaves no usable Finding, the semantic run
  fails explicitly as `semantic_reference_invalid`.
- Durable Finding V3 remains unchanged. Provider/run contract V4 is a boundary
  migration, not a second diagnostic pipeline.

## Consequences

The model can no longer manufacture a section/node combination. Individual bad
references are contained at Finding scope rather than rejecting an otherwise
usable run. Some malformed Findings may be omitted, and content-free
normalization telemetry makes that loss auditable. Historical data stays
readable and rollback can temporarily write the prior V3 contract through the
same repository RPC.
