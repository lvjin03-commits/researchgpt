# ADR 0068: reduce full-review analyses hierarchically and label partial results

## Status

Accepted for implementation; production deployment requires separate authorization.

## Decision

When all validated full-review unit analyses cannot fit one synthesis request, group them within the
authoritative synthesis budget, produce validated reduction units, and repeat until one final
synthesis request fits. Persist each reduction using the same Revision-, question- and content-bound
checkpoint discipline as original review units.

If an eligible downstream failure occurs after one or more original units completed, return an
explicitly partial, grounded answer assembled only from those validated units. Persist its exact
coverage metadata with the result. Never describe partial delivery as complete whole-document
analysis.

## Consequences

- Full-document review no longer requires all intermediate conclusions to fit one request.
- Provider interruptions after useful work can return a bounded, honest result instead of losing
  completed work.
- Reduction adds model calls only when the final synthesis cannot fit directly.
- Partial results may be less coherent than a completed synthesis, so the UI exposes incomplete
  coverage and unfinished synthesis.
- Model identity and source aliases are validated across original units, reductions and final output.

## Rejected alternatives

- Increase the final synthesis limit: model-dependent and does not scale with document size.
- Truncate unit analyses silently: breaks coverage and evidence traceability.
- Return completed units while marking the review complete: misrepresents product behavior.
- Retry the whole turn: duplicates paid work and can hide the original failure.
