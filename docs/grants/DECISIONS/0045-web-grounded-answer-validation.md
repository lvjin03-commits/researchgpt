# ADR 0045: Web-grounded answer validation

## Status
Accepted as step 7 offline foundation; no production model path is enabled.

## Decision
Web relevance assessment and answer synthesis are separate model proposals. The
assessment must classify every current search result exactly once. Low-trust
sources cannot be promoted to recommended. Synthesis may cite only recommended
source IDs from that same search and every claim must have at least one source.

The program, not the model, assigns display aliases and citation IDs and builds
the final content from validated claim statements. A deterministic overlap gate
rejects claims containing long verbatim character or word sequences from a
source snippet, requiring a rewritten proposal. This is a safety threshold, not
a legal conclusion or factual-entailment proof.

The assembled output reuses the sole Grant Assistant answer contract. General
web results use `web_source`; they must not be presented as `academic_source`.
The response exposes searched, recommended and excluded counts and the actual
sources used. It has no Patch, Candidate, Evidence authorization or Revision
write authority.

## Consequences
The UI can later render one normal assistant answer with traceable sources while
program checks prevent decorative source lists, invented IDs and direct snippet
copying. Provider prompts, model execution, retry/telemetry and runtime wiring
remain later work and must use the Operations registered by ADR 0043.
