# Impact Analysis 0033: Apply an Edit Candidate through canonical Patch ownership

## Outcome

Allow the user to apply the active, program-approved Candidate without giving Edit Session write authority.

## Write path

`GrantAiEditSessionService` rechecks session state, current Revision, target-node hash, Candidate safety and current material authorization. It then asks `GrantPatchService` to assemble a pending proposal from the approved Candidate. `GrantPatchService` independently revalidates the Finding anchor, selection, fact policy, evidence and operation scope. Its existing `accept` path performs the only canonical Revision compare-and-swap.

The Edit Session is marked `applied` only after the Patch has an accepted Revision ID. Repeating apply returns the recorded proposal and Revision rather than writing a second revision.

## Finding continuity

`originFindingId` becomes the Patch Proposal `findingId` and Revision audit metadata. The existing diagnostic projection compares that Finding's source Revision with the new Revision and exposes `needs_recheck`; the Edit Session does not declare the Finding resolved.

## Safety

Only `passed` Candidates may be applied in this step. `needs_confirmation`, `blocked` and `needs_repair` must be repaired or regenerated. No direct Candidate-to-document repository call is introduced.

## Rollback

Disable the Edit Session apply entry point. Accepted revisions remain canonical and recoverable through existing revision history; pending Candidate records remain proposals.

