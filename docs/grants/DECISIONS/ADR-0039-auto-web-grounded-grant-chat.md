# ADR 0039: Automatic web-grounded Grant chat

## Status

Accepted as the design baseline; implementation is staged and not yet exposed.

## Decision

The Grant assistant supports two distinct web behaviors:

1. Ordinary chat may automatically search an approved provider, have the model
   rank relevance, and answer without requiring the user to select each result.
2. Formal application modification continues to require explicit user-selected
   source snapshots, existing Evidence Card authorization, and the existing
   Edit Session/Patch path.

Every substantive web-grounded claim must reference program-owned source IDs.
The program validates that each ID came from the current search, that the
source's deterministic trust tier was not changed by the model, and that the
claim is not an excessive copy of the bounded source snippet. Unmapped or
insufficiently supported claims are labeled as such.

OpenAlex remains an academic-search provider. General web search, including a
future Google adapter, requires its own provider port, operation, trust policy,
data-flow audit and billing policy. No full article or page body is required
for the first release; bounded snippets and source metadata are sufficient.

## Consequences

The normal question path can feel like GPT-style web assistance while keeping
formal writes user-authorized and auditable. Search results can be ranked and
filtered automatically for answer quality, but the model cannot authorize a
source, assign its trust tier, invent source IDs, or write canonical content.

This decision supersedes only the ordinary-chat portion of ADR 0034; ADR 0034
continues to govern confirmed snapshots and all Edit Session use.
