# ADR 0059: Formal research evidence pipeline cutover

## Status

Accepted.

## Context

The resumable Grant web workflow previously evaluated source relevance and then
asked a model to synthesize claims directly. That path could repeat content
already present in the application, confuse planned work with evidence, and add
adjacent literature topics that enlarged the project scope.

## Decision

The production answer-synthesis phase now invokes the single
`executeGrantResearchEvidencePipeline` application boundary. OpenAlex records
already persisted in the version-1 resumable checkpoint are deterministically
rehydrated as structured academic abstracts; ordinary web excerpts are never
promoted to academic evidence. The model proposes source assessments, existing
design comparisons and a final selection in one structured response. Programs
validate numerical support, application-location references, residual-gap
semantics, scope signals and final selection before adapting the approved
content to the existing grounded-answer delivery contract.

The persisted checkpoint schema and the earlier query, search and source-
assessment artifacts remain readable. This is an in-place behavioral cutover,
not a parallel public route or database migration. Existing-results delivery
continues to use the legacy bounded summarizer because it is the no-additional-
research fallback promised by the budget flow.

## Consequences

- Normal completed research answers cannot bypass existing-design and scope
  validation.
- Old paused checkpoints remain resumable without data rewriting.
- Source-group IDs are reconstructed per resumed model attempt and never exposed
  as durable evidence identity; immutable source IDs remain authoritative.
- A model implementation without the new optional method retains an explicit
  compatibility fallback for offline/legacy adapters. Production composition
  uses `OpenAIGrantWebGroundingModel`, which implements the governed method.
- No real paid provider call is part of offline verification.
