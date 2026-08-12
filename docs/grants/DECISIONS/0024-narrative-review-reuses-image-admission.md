# ADR-0024: Narrative Review reuses current diagnostic image admission

## Status

Accepted as target-only Semantic Review V6 execution. Production selection is
unchanged.

## Decision

1. Narrative Review consumes the frozen V6 document scope but does not consume
   or reinterpret Scientific Findings.
2. The existing Grant Model Data Gateway image admission remains the only
   authority that may materialize authorized application images.
3. `I*` aliases are execution-local and map atomically to one admitted figure
   location and one program-owned asset ID.
4. `visual_communication` Findings require at least one actually supplied
   image alias. Captions or omitted images are not treated as visual access.
5. Non-visual Narrative Findings cannot claim image aliases.
6. The provider adapter owns no retry or default token budget.

## Consequences

- Revocation and capacity degradation retain existing semantics.
- Narrative Review can distinguish text-only from multimodal coverage without
  creating a second image authorization path.
- Visual Findings remain traceable to canonical figure assets while the model
  never sees or creates asset UUIDs.
