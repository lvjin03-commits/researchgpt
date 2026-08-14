# ADR 0030: Separate conversational and semantic candidate ancestry

## Decision

Persist Edit Session, Turn and Candidate as proposal-only records. Store both `basedOnCandidateId` and `semanticBaseCandidateId`.

`basedOnCandidateId` is the literal prior candidate in the user-visible conversation and audit chain. `semanticBaseCandidateId` is the candidate whose text was actually provided to the model. Only a `passed` candidate may become the semantic base in Step 2; otherwise generation falls back to the session's last safe candidate or frozen original text.

Each turn uses registered operation `grant.edit_session.turn`, the unified executor and the existing Model Data Gateway. Revision or node-hash drift marks the session stale before dispatch.

## Consequences

Users can refine a candidate repeatedly without silently restarting from canonical text. Unsafe intermediate text remains auditable but cannot contaminate later semantic context. Candidates have no write authority; a later step must translate an explicitly accepted candidate into the existing Patch and Revision path.

