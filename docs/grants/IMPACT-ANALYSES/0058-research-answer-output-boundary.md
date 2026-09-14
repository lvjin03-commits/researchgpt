# Impact analysis: evidence-based Grant research answer output

## Problem

Even after evidence and scope validation, a free-form final model call could
reintroduce a rejected topic, omit an approved main gap or flatten source
provenance into decorative citation labels.

## Authority and output changes

- The model proposes a core judgment and selects only current candidate group
  IDs. It does not author new recommendations at the output stage.
- The answer assembler owns eligibility checks, required main-suggestion
  coverage, numbering, source expansion and rejected-candidate audit output.
- Residual gaps and recommendations come from the validated comparison layer.
- General-web search excerpts cannot support quantitative findings.
- Every completed result carries a validated research-run trace, including
  pipeline, source, evidence, scope and synthesis versions plus fallback state.

## Compatibility and rollout

The contract is additive and offline-verified. Existing persisted assistant
answers remain readable. Production orchestration must persist the new
comparison artifacts and trace before switching final delivery to this
assembler. No canonical document write or paid Provider call is authorized by
this change.

## Verification

- Output is rendered as one core judgment followed by numbered suggestions.
- A rejected candidate cannot be selected or rendered.
- Every program-approved main suggestion must be included.
- Source expansion exposes DOI and evidence origin.
- Trace timestamps and version fields are validated.
