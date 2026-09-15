# ADR 0060: Revision-bound grant document memory

- Status: accepted, implementation complete; production rollout pending
- Date: 2026-09-15
- Owner: Grant Model Data Gateway

## Decision

The Grant workspace will build one reusable semantic memory after a complete read
of the current canonical Revision. The memory is a rebuildable derived artifact,
not a second document and not durable identity. It contains an overall summary,
one summary for every canonical section, semantic facts, model-generated concepts
and program-resolved source-node anchors.

The existing full-document projection and capacity router are the only input and
chunking authorities. Every canonical section and node must be admitted before a
memory can be marked complete. The model may propose summaries, semantic facts
and concepts using execution-local aliases. The program validates those aliases,
resolves them to canonical IDs, assigns memory-item IDs, records exact coverage
and fingerprints the result. A model cannot declare coverage or invent internal
IDs.

Reuse requires an exact match on document, source Revision, context hash and
memory-policy version. A new Revision or memory policy causes a rebuild; stale
memory is never silently reused. The repository stores and returns snapshots but
has no authority to select stale content or dispatch a model.

Step 1 adds the contract, builder, repository port and offline verification. It
does not activate a provider adapter, add a parallel assistant route, call a paid
provider, change billing, apply a database migration or deploy production code.

Step 2 adds one memory-first semantic context planner. It receives the current
Revision memory plus recent conversation and explicit user context facts, then
proposes whether answering requires memory only, targeted original text or the
complete original; whether current diagnostics are relevant; and whether web
search should be recommended. It does not use phrase or keyword matching.

The program validates every proposed section and memory-item alias and resolves
them to internal IDs. The planner may recommend web search but cannot enable it,
reserve points or grant Evidence/image access. It cannot authorize a document
write. Current production routing is not switched in Step 2; the legacy phrase
matcher remains until effect-first comparison and an explicit cutover remove it.

Step 3 adds one planned-context assembler. Memory is always present. For
`targeted_original`, program-owned section hierarchy and memory anchors select
the exact current canonical nodes, including descendants of a selected parent
section. For `full_original`, the existing complete full-document projection is
the only source. No model-generated text is accepted as original text.

Diagnostic access uses only normalized, open Findings whose source Revision is
the current Revision. Relevant access matches the plan's canonical section and
node targets; all access admits every current open Finding. Located diagnostic
anchors are checked against the current canonical node/section relationship and
fail closed if invalid. Memory, original text and diagnostics retain distinct
source types so answer citations can disclose what actually supported a claim.

Step 4 composes memory construction/reuse, semantic planning, planned-context
assembly and grounded answering into one candidate pipeline admitted by the
Grant Model Data Gateway. The configured OpenAI Grant adapter implements the
three structured model contracts. The pipeline verifies one configured model
identity, stops before answer generation when clarification is required, rejects
an over-capacity final context without truncation, and returns aggregate usage
and provider request IDs for the existing model-execution and billing authority.

Memory-build usage is included only when a new snapshot is created. Reusing a
matching snapshot never re-reports its historical provider usage as current-turn
cost. Planning and answer usage remain current-turn costs. The pipeline remains
inactive in production in Step 4: no route switch, durable migration, real paid
verification or deployment occurs before the final cutover step.

Step 5 replaces the ordinary unscoped Grant Assistant path with the memory-first
pipeline. The first turn builds and durably stores a complete Revision-bound
memory; later turns reuse it, ask the semantic planner which exact original text
and current diagnostics are needed, and validate grounded output. The complete
multi-call turn remains one `grant.assistant.chat` execution and billing bundle.
Explicit document selection, Candidate and Evidence turns retain their existing
authoritative context paths. User-enabled web research remains separately
budgeted and now receives complete canonical document context without phrase
matching.

Migration 072 and schema marker 072 are mandatory before activation. The legacy
phrase matcher is deleted; rollback disables the assistant flag or reverts the
runtime commit while leaving derived memories safely deletable. This decision
does not authorize applying the migration, changing production environment
variables, deploying, or making a paid verification call.

## Consequences

- Later turns can use a compact whole-application understanding without sending
  the full application on every question.
- Any claim in memory remains traceable to canonical source nodes.
- Full text can still be fetched on demand for quotation, detailed explanation,
  conflict checks and formal edits; memory is not treated as verbatim source.
- Current diagnostic Findings, Evidence authorization and web sources remain
  separate authorities and are not copied into document memory.
- Activation reuses the existing Model Data Gateway, registered execution and
  billing policy; durable storage is provided by migration 072 and remains
  gated by schema marker 072.
- The semantic planner is a context-selection stage, not a second chat route or
  answer generator. Its activation must be included in the same auditable turn.
- Memory summaries never substitute for verbatim original text when the plan
  requests detailed explanation, comparison or formal revision guidance.
- The current `grant.assistant.chat` Operation remains the intended visible-turn
  bundle; the candidate pipeline calculates facts but cannot deduct points.
