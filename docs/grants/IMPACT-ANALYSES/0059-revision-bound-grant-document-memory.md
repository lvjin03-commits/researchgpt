# Impact analysis: Revision-bound grant document memory

## Problem

The current assistant either receives a small retrieved excerpt set or performs
a new full-document analysis. It has no reusable, Revision-bound semantic view
that represents a completed first reading of the application. Repeated broad
questions therefore repeat expensive document admission, while narrow retrieval
can truthfully cover only selected fragments.

## Step 1 scope

Add one derived-memory contract and builder behind Grant ports. The builder
reuses the existing complete canonical projection, deterministic capacity route
and lossless analysis-unit splitter. It analyzes every unit, performs one final
synthesis, rejects unknown aliases and incomplete section summaries, resolves
source aliases to canonical node IDs, and persists only through a dedicated
repository port. Exact Revision, context-hash and policy-version equality is
required for reuse.

An in-memory adapter and offline fake-model verification prove complete coverage,
source grounding, cache reuse without repeat model calls, rebuild on Revision
change and rejection of fabricated references. No production provider call,
database migration, UI route, runtime cutover or deployment is included.

## Step 2 scope

Add one semantic context-planning contract behind a Grant model port. The planner
reads the compact complete memory and recent conversation, not the full canonical
text, and proposes answer mode, original-text depth, diagnostic depth, relevant
memory targets and a non-authoritative web recommendation. No hard-coded subject
or intent keyword list participates in the decision.

The application service rejects stale memory, over-capacity input, unknown
aliases, targetless original-text requests, malformed clarification decisions and
missing provider identity. It maps accepted aliases to program-owned section and
memory-item IDs and fingerprints the plan. Explicit selection, candidate,
Evidence and user web-toggle facts are inputs; the planner cannot override their
existing authorities. This step remains offline and does not replace the active
Grant Assistant matcher or add a paid provider call.

## Step 3 scope

Add one deterministic planned-context assembler. It always admits the current
memory, then resolves `memory_only`, `targeted_original` or `full_original`
against the canonical snapshot. Targeted parent sections include canonical
descendants; memory-item targets contribute their program-resolved source nodes
and sections. Full-original mode reuses the existing complete projection.

For requested diagnostics, the assembler reads the normalized Finding
repository, filters to the current Revision and open lifecycle state, and either
selects target-related Findings or all current Findings. Every located source,
related location and root occurrence is validated against the canonical node to
section relationship. It exposes exact coverage counts and distinct memory,
original-text and diagnostic source types for later citation assembly. It does
not call a model, decide authorization, generate an answer or modify canonical
content.

## Step 4 scope

Compose Steps 1-3 with grounded answer generation behind one Grant Model Data
Gateway method. The candidate executes a lazy first read, reuses matching memory
on later turns, plans context semantically, assembles exact sources and validates
the answer's claim-to-source bindings. Clarification ends the pipeline before the
answer call. The complete assembled answer input is capacity checked and fails
explicitly rather than dropping a source.

Extend the existing OpenAI Grant adapter with separate structured methods for
memory-unit reading, memory synthesis and semantic context planning. Method names
do not overlap the existing whole-document question-analysis contract. All
stages report provider identity, request IDs and usage. The candidate enforces
the configured model identity and aggregates only provider work performed in the
current turn; reused memory does not duplicate historical cost.

This step is verified with fake models and a fake OpenAI client. It makes no
network request, does not activate the candidate in `GrantAssistantChatService`,
does not persist memory in Supabase and does not deploy. Final activation must
wrap the aggregate usage in the existing model executor/point billing authority,
provide durable storage and delete the phrase matcher after effect-first parity.

## Step 5 scope

Add an owner-scoped Supabase repository and migration 072 for immutable,
Revision-bound memory snapshots. Exact document, Revision, context hash, policy
version and configured model identity control reuse. The Grant Assistant schema
gate moves to 072 so code cannot activate before storage is ready.

Replace the ordinary unscoped chat execution with the memory-first pipeline
inside the existing `grant.assistant.chat` executor. All memory, planning and
answer usage performed during the turn is reported as one existing billing
bundle. Reused memory contributes no historical usage to a later turn. Explicit
selection, Candidate and Evidence paths keep their existing context authorities.
Web research remains a separate user-budgeted flow and receives full canonical
context after the phrase matcher is removed.

The UI reports whether an answer used complete semantic memory, targeted
original text or the complete original, instead of implying that compact memory
is verbatim full-text admission. Offline service verification covers the public
chat service entry point and proves ordinary questions no longer use keyword
routing. Production migration, environment-marker change, deployment and paid
provider verification remain separate authorized rollout actions.

## Ownership and affected modules

- Canonical content and Revision ownership do not change.
- Grant Model Data Gateway owns future admission and memory construction.
- The memory model owns semantic proposals only.
- The memory builder owns validation, canonical anchor resolution, IDs, hashes,
  coverage and reuse rules.
- The Grant Assistant Context Planner owns the semantic context proposal and its
  target validation; it owns no authorization or answer content.
- The Planned Context Assembler owns canonical plan resolution, current Finding
  filtering, anchor validation, source aliases and coverage facts; it does not
  reinterpret diagnostic conclusions.
- The repository owns storage only.
- Diagnostic, Evidence, web-search, Patch and export authorities are unchanged.

## Risks and controls

- **Stale understanding:** exact Revision and context hashes prevent reuse.
- **False coverage:** coverage is computed from canonical analysis units, never
  accepted from model prose.
- **Hallucinated provenance:** every model source alias is allow-list validated.
- **Duplicate document truth:** memory is explicitly derived and rebuildable;
  formal reads and writes continue to use canonical nodes.
- **Unbounded cost:** the active candidate is wrapped by the existing registered
  `grant.assistant.chat` executor and billing integration; web research keeps its
  independent user-authorized budget.

## Rollback and deletion condition

Rollback disables the existing Grant Assistant flag or reverts the runtime
cutover. Migration 072 stores only rebuildable derived snapshots and may be
retained safely during rollback; later deletion may drop the two RPCs and table
after no deployed runtime uses schema marker 072. Canonical documents, chat
sessions, Findings and model-call audit rows are unchanged.
