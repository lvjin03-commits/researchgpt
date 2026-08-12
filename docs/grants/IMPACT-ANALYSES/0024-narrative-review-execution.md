# Impact Analysis 0024: Narrative Review V6 execution

## Problem and evidence

Scientific Review intentionally does not judge reading flow, emphasis, opening
persuasion, abstract self-containment, language register or visual
communication. Putting those judgments into Scientific Findings would weaken
the verify-before-report scientific contract and blur product meaning.

## Ownership

- Versioned Semantic Checker Contract owns narrative interpretation.
- Grant Model Data Gateway owns the frozen document scope and current image
  authorization/materialization.
- Narrative Review Assembler owns alias resolution, image-scope validation and
  bounded deterministic degradation of related locations.
- A later aggregate V6 orchestrator owns total calls, token budget and retry.

## Implemented scope

- Build a Narrative Review request from the same frozen V6 document and `N*`
  scope used by Fact Map and Scientific Review.
- Represent current image coverage explicitly. Only images actually admitted
  to the provider receive `I*` aliases.
- Add a narrative-only prompt and strict Narrative Finding output.
- Resolve locations and image aliases through program-owned maps.
- Add a one-attempt OpenAI adapter with safe failure metadata and no private
  retry, persistence, rollout selection, route or UI.

## No parallel authority

This is target-only V6 infrastructure. It reuses the existing image admission
provider and attachment adapter. It creates no second authorization check,
image store, model gateway, diagnostic entry point or persistence model.

## Risks and controls

- Scientific/narrative leakage: the prompt and strict schema prohibit
  scientific residual-gap fields in Narrative Findings.
- False visual claims: `visual_communication` is publishable only when every
  claimed `I*` alias was actually supplied in the current call.
- Revoked/omitted images: text-only coverage is explicit and visual diagnosis
  is disabled rather than inferred from captions.
- Reference fabrication: invalid primary locations discard the candidate;
  invalid related locations degrade locally.
- Cost growth: the executor performs one provider call and requires a caller
  supplied completion budget.

## Rollback

Remove the additive Narrative Review files, tests and documentation. There is
no migration, production state, feature flag or user data to roll back.
