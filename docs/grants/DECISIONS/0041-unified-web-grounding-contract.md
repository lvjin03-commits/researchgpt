# ADR 0041: Unified web grounding contract

## Status
Accepted for step 3; runtime integration is not yet enabled.

## Decision
Ordinary web-grounded Grant chat uses one versioned `GrantWebSourceRecord` for
all approved providers. The record carries public metadata, a reusable content
fingerprint and the exact program-owned trust-registry decision. Document and
conversation usage remain separate associations in a later persistence step.

Model synthesis receives source IDs and bounded snippets. It may return only a
relevance disposition, reason, claims and source-ID bindings. It cannot return
source metadata, provider identity, trust tier or registry version. The program
rejects duplicate assessments and every reference outside the current search.

The existing `GrantWebSearchResult` remains temporarily for the confirmed-source
Edit Session flow. Provider integration must migrate it to the canonical source
record before ordinary web chat ships; the legacy shape is deleted only after
stored sessions are backward-readable and the confirmed-source flow passes.

This contract does not establish factual entailment, paraphrase safety, query
egress permission, fetch safety, Evidence authorization, pricing or a formal
write. Those remain separately owned gates.
