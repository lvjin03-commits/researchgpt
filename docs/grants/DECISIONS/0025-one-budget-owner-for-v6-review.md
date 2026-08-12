# ADR-0025: One aggregate budget owner for Semantic Review V6

## Status

Accepted as target-only execution infrastructure. Production selection is
unchanged.

## Decision

1. Normal V6 execution is exactly three paid calls: Fact Map, Scientific
   Review and Narrative Review.
2. The aggregate maximum is four paid calls. At most one review stage may use
   the exceptional recovery call.
3. Fact Map is never automatically retried because all later semantic work
   depends on its identity and anchors.
4. A recovery is allowed only for output truncation (with a larger completion
   allocation) or an explicitly retryable provider failure. Deterministic
   contract/reference/evidence/image/coverage failures stop immediately.
5. Current image admission is materialized immediately before every paid
   Narrative Review attempt.
6. Completed Fact Map and Scientific Review results are revision- and
   fingerprint-bound checkpoints; later persistence may store them but cannot
   reinterpret them.

## Consequences

- Stage-specific rules cannot silently multiply calls.
- A Scientific Review recovery consumes the same ceiling that would otherwise
  be available to Narrative Review recovery.
- Failures identify the exact stage, call count, usage and safe checkpoint.
