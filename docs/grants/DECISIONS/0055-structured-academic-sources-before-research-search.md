# ADR 0055: Structured academic sources precede research-task search

## Status

Accepted as a target architecture. Not implemented or active in production.

## Context

ADR 0050 correctly replaced an unusable unrestricted Google search integration
with OpenAI native web search for general-web discovery. Its adapter converts
URL citations from a generated answer into bounded source records. That text is
useful citation context, but it is not a paper abstract and does not reliably
contain publication dates, DOI metadata, mechanisms or quantitative results.

The Grant Assistant now needs research-task answers that compare the canonical
application with recent academic work. Increasing query count, token limits or
prompt specificity before improving source provenance would spend more against
the same information ceiling.

## Decision

Research-task search uses a composed source acquisition boundary with distinct
authorities:

1. a structured academic Provider owns paper metadata and abstracts;
2. OpenAI native web search owns supplementary general-web discovery and returns
   citation context, not academic abstracts;
3. an optional bibliographic enrichment adapter verifies or fills DOI, venue and
   publication dates without changing evidence provenance;
4. one application service owns deterministic normalization, deduplication and
   ordering before sources enter assessment.

`qualityTier` remains assigned by the program's versioned trust registry. Models
cannot change provenance, quality tier, DOI, publication date or provider
identity. They may later extract proposed mechanism summaries and quantitative
findings only from admitted evidence text; absence must remain absence.

The existing web-grounded orchestration, assessment, claim-binding, billing and
answer-validation authorities will be extended. No parallel route or answer
renderer is introduced.

No full article body is fetched or stored under this ADR. A limited article-body
exception, if ever needed, requires a separate decision and rollout.

## Consequences

- ADR 0050 remains active for general-web discovery but no longer defines the
  sole source type for academic research-task answers.
- Provider identity is insufficient to describe evidence semantics; the source
  contract must also record evidence-text provenance.
- Multi-query planning and resumable user budgets follow only after structured
  academic acquisition and evidence extraction pass their own gates.
- Production keeps the current behavior until an explicit migration and rollout
  are authorized and effect-first verified.

