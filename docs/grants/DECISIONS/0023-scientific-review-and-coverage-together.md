# ADR-0023: Return Scientific Findings and Fact Map coverage together

## Status

Accepted as target-only Semantic Review V6 execution. Production selection is
unchanged.

## Context

A model can omit an innovation claim or scientific question while still
returning several plausible Findings. Absence from Finding output therefore
cannot prove that the object was reviewed. Conversely, requiring a Finding for
every object would manufacture weak issues where the application is adequate.

## Decision

1. One Scientific Review response contains candidate Scientific Findings and
   one explicit coverage disposition for every frozen Fact Map object.
2. `verified_no_residual_gap` publishes no Finding; `unable_to_verify` publishes
   no Finding and records a bounded reason.
3. `residual_gap_found` must bind at least one successfully assembled Finding.
4. Scientific Findings must record existing design and evidence tier before
   reporting the residual gap.
5. The program validates all aliases and evidence authorization, then runs the
   existing Fact Map Coverage Assembler. It never infers completeness from
   prose.
6. The provider adapter owns no retry or default token budget.

## Consequences

- Innovation and scientific-object coverage becomes measurable.
- “Already present but insufficient” is distinguishable from “not present”.
- Invalid model references cannot become canonical Finding content.
- Later aggregate execution can budget Fact Map, Scientific Review and
  Narrative Review without competing retry counters.

