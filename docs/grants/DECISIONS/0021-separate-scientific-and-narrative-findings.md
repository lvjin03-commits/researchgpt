# ADR-0021: Keep scientific and narrative Findings separate

## Status

Accepted as a target-only Semantic Review V6 contract. It does not change
active production diagnosis.

## Context

Scientific review asks whether claims, evidence, objectives and methods leave a
residual gap after accounting for what the application already provides.
Narrative review asks whether presentation order, emphasis, opening, abstract,
register or a figure creates avoidable reader friction. These questions do not
share the same factual structure.

## Decision

1. Scientific Findings use the existing eight scientific categories and must
   record existing design, evidence tier, residual gap and insufficiency reason.
2. Narrative Findings use a separate six-category taxonomy and record observed
   presentation, reader friction and suggested organization.
3. Neither contract contains severity, priority or funding-outcome prediction.
4. `visual_communication` requires a program-resolved, currently authorized
   figure asset. Other narrative categories cannot claim figure use.
5. Execution-local Finding references are unique across both families, while
   durable continuity remains owned by Diagnostic Assembler.

## Consequences

- Verify-before-report remains meaningful for scientific issues.
- Narrative feedback can improve readability without being mislabeled as a
  scientific deficiency or forcing a whole-document rewrite.
- Later provider routing and budgets can treat the two axes independently while
  remaining under one aggregate diagnostic operation.
- UI may later group the two families, but default ordering remains canonical
  source order and does not create a severity hierarchy.

