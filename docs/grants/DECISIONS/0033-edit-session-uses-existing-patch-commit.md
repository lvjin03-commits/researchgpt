# ADR 0033: Edit Session delegates canonical writes to Patch Service

## Decision

An approved Candidate is converted into the existing single-operation `GrantPatchProposal` contract and accepted through `GrantPatchService` and `GrantRevisionService`. Edit Session never mutates the canonical document.

The Patch Service reconstructs hashes and operations from the current canonical snapshot rather than trusting Candidate-supplied structure. It also re-resolves an optional originating Finding against the current target node.

After CAS succeeds, the Session stores the accepted Candidate, Patch Proposal and Revision IDs. Idempotent repeat apply returns those IDs and cannot create another Revision.

## Consequences

There is one write authority, one concurrency decision and one audit trail. Existing diagnostic continuity automatically presents an origin Finding as needing recheck after the new Revision; applying a Candidate is not proof that the scientific issue is resolved.

