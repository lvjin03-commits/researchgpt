# ADR-0007: Evidence context is materialized from current authorization at dispatch

- Status: accepted
- Date: 2026-08-07
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

The authorization spike queued a model task, cached a context, created one
draft patch and one accepted revision, then revoked the source. The queued task
was blocked at dispatch, the cache was removed, the unaccepted draft became
`evidence_revoked`, and the accepted revision retained audit provenance only.

## Decision

Queued model work stores source identities and intent, never a send-ready
evidence excerpt. The Grant Model Data Gateway queries current authorization
and materializes excerpts immediately before every provider call.
`authorizationRevision` participates in context-cache identity. Revocation
actively invalidates queued work, caches, and unaccepted dependent patches.

## Consequences

- UI authorization state and cached snapshots are not security boundaries.
- Accepted revisions remain auditable but revoked excerpts cannot enter future
  model contexts.
- PR6 must implement propagation transactionally and test delayed queued work.

## Verification

- Queue, cache, draft, accepted-audit, and future-call assertions pass in
  `scripts/grant-spikes/run_spikes.py`.
