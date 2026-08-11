# ADR-0020: Make Fact Map review coverage explicit

## Status

Accepted as a target-only Semantic Review V6 contract. It does not change
active production diagnosis.

## Context

Inferring review coverage from the presence or absence of Findings confuses
three different states: a residual gap exists, the object was checked and no
gap remains, or the available material was insufficient to verify it. Free
model prose cannot reliably distinguish these states for a program quality
gate.

## Decision

1. Every frozen semantic object receives exactly one coverage disposition:
   `residual_gap_found`, `verified_no_residual_gap`, or `unable_to_verify`.
2. A residual gap must bind at least one execution-local Finding reference.
   Verified-no-gap and unable-to-verify objects bind none.
3. Unable-to-verify requires a bounded reason; authorization or input loss is
   never interpreted as issue resolution.
4. The program validates the coverage set against the frozen semantic-object
   and Finding sets. It does not infer completeness from free text.
5. Coverage is revision-bound run scaffolding. Durable Finding continuity
   remains anchored to canonical document nodes through Diagnostic Assembler.

## Consequences

- Innovation and scientific-question review completeness becomes measurable.
- A candidate with no residual gap can be discarded without appearing as an
  unexamined omission.
- A later rollout can expose incomplete review truthfully without inventing a
  severity or silently closing an older Finding.
- Provider output and program validation remain separate because Structured
  Outputs cannot enforce application reference membership.

