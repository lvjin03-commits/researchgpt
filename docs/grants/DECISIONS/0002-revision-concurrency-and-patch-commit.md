# ADR-0002: Revision Service arbitrates concurrent formal writes

- Status: accepted
- Date: 2026-08-07
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

Users may edit while an AI patch is being generated. A valid patch based on an
old revision must never overwrite newer canonical content.

## Decision

Patch Commit Service validates operation scope, hashes, constraints, and
evidence. Revision Service performs the final atomic compare-and-swap. A stale
base revision fails with `revision_conflict`; no module silently merges or
overwrites it.

## Consequences

- User acceptance authorizes a commit attempt, not a forced write.
- All formal writes produce immutable revisions.
- API routes and UI components cannot update canonical content directly.

## Verification

- Two concurrent writers produce one successful current-revision transition.
- A stale patch produces no partial revision or downstream recheck.
- Patch concurrency spike is required before editor implementation.
