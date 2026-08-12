# Impact Analysis 0021: Scientific and narrative Finding contracts

## Problem and Evidence

- Scientific residual gaps and presentation friction are different judgments.
  Reusing one Finding structure would make `existingDesign` meaningless for
  narrative advice and would weaken the verify-before-report discipline.
- Scientific diagnosis must acknowledge what the application already provides,
  distinguish evidence strength and report only the remaining gap.
- Narrative diagnosis must describe current presentation, reader friction and
  a bounded organization suggestion without pretending that prose preference is
  a scientific evidence gap.

## Ownership

- The versioned Semantic Checker Contract owns both content contracts but keeps
  their fields and category sets separate.
- Grant Model Data Gateway remains the only owner of canonical location,
  Evidence Card and figure-asset admission.
- A later assembler resolves all provider references; provider output never
  becomes canonical identity or authorization proof.
- Diagnostic Assembler remains the owner of durable identity and cross-run
  continuity for both Finding families.

## Implemented Scope

- Define strict provider and bounded program contracts for Scientific Finding
  V1 and Narrative Finding V1.
- Scientific Findings record semantic objects, original existing design,
  explicit evidence tier, residual gap and why the existing design remains
  insufficient.
- Narrative Findings record observed presentation, reader friction and a
  suggested organization, with a separate six-category taxonomy.
- Add one combined result invariant that keeps `F*` references unique across
  both axes.
- Require resolved authorized figure assets for visual-communication Findings;
  nonvisual Findings cannot claim figure use.

## No Parallel Authority

These are target-only contracts inside the existing Semantic Review V6 module.
They add no checker, button, route, provider call, resolver, retry, repository,
table or UI. Active Semantic V5 behavior remains unchanged.

## Risks and Controls

- Axis contamination: strict schemas reject fields owned by the other Finding
  family.
- Hidden severity: neither contract contains severity or priority.
- Evidence overclaim: scientific existing-design items carry a mandatory tier;
  authorized-evidence Findings must identify an Evidence Card.
- Output growth: program contracts bound text, Finding count, existing-design
  entries and related locations. Provider capacity policy remains later work.
- Image authorization: program content requires resolved figure asset IDs;
  later assembly must recheck current revision-bound authorization.
- Identity collision: Finding references are unique across both output axes.

## Rollback

Remove the additive contracts, tests and documentation. No production data or
behavior requires rollback.

## Verification

- Both provider schemas compile as strict Structured Outputs.
- Scientific schema rejects severity and narrative-only fields.
- Narrative schema rejects priority and scientific-only fields.
- Scientific evidence-basis and existing-design uniqueness rules pass.
- Visual Findings require a figure asset; nonvisual Findings cannot claim one.
- Combined output rejects a duplicate Finding reference across axes.
- Active Semantic V5 versions and runtime selection remain unchanged.

