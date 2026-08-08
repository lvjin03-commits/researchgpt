# ADR-0006: Revision advance is an atomic compare-and-swap

- Status: accepted
- Date: 2026-08-07
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

The concurrency spike generated an AI patch from revision 1, committed a user
edit as revision 2, and then attempted the stale patch. The stale write was
rejected and the user's content remained current. Two simultaneous revision-1
writers produced exactly one commit and one `revision_conflict`.

## Decision

Revision Service performs base-revision comparison and current-revision advance
inside one atomic storage operation. Patch Commit Service may validate content
beforehand but cannot write or silently merge after the base becomes stale.

## Consequences

- User acceptance authorizes one compare-and-swap attempt, not overwrite.
- Provider retries and UI resubmission reuse the same patch identity and cannot
  bypass revision arbitration.
- PR1 storage adapters must prove this property against the actual database.

## Verification

- Stale scenario preserves the user edit.
- Simultaneous scenario yields one commit and one conflict.
- `scripts/grant-spikes/run_spikes.py`
