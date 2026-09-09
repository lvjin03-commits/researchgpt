# Impact Analysis 0039: automatic web-grounded grant chat

## Intended outcome

Allow ordinary Grant assistant questions to use automatically retrieved public
web information as supplementary context, while keeping user confirmation as
the gate for any formal application-writing action.

## Existing authorities retained

- Canonical grant content and revisions remain owned by the Grant Document and
  Revision Services.
- Ordinary chat remains `grant.assistant.chat`; web search cannot route to an
  edit or patch operation.
- The Grant Model Data Gateway remains the only model-context builder.
- Evidence Authorization, Evidence Cards and Patch Commit remain mandatory
  when a web source is used for formal document modification.
- Search-provider output is not evidence and cannot create a Candidate or Patch
  without explicit user confirmation.

## New boundary

Ordinary web-grounded answers may use model-ranked search results without
per-result user selection. Any claim shown as source-backed must carry a
program-validated source mapping. Formal edits still require a user-confirmed
snapshot and the existing Evidence flow defined by ADR 0034.

## Provider and data policy

OpenAlex keeps its academic-search semantics. A future Google provider is a
separate provider, operation and quality policy; it must not be added by
expanding the OpenAlex adapter. Queries sent externally are abstracted and
audited; unpublished identifiers, exact application prose, private people,
project numbers and unique experimental details are excluded.

## Storage and observability

Ordinary answers retain only bounded source metadata (title, snippet, URL,
retrieval time, hash and trace). Public source content may be cacheable across
documents, but query/use/audit records are document-scoped. Search and model
calls have independent operation, trace and billing facts.

## Exit conditions

Before runtime exposure, the implementation must provide deterministic trust
classification, claim-to-source validation, snippet-overlap checks, failure
fallback to document-only chat, and regression coverage for formal-edit
authorization boundaries.
