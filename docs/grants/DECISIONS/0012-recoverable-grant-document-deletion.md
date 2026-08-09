# ADR-0012: Grant document deletion is a recoverable lifecycle transition

- Status: accepted
- Date: 2026-08-09
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

The grant project list needs a user-facing delete action. Hard deletion would
also affect immutable revisions, diagnostics, patch proposals, evidence,
stored source files and backup retention. Treating a card removal as immediate
physical purge would make accidental clicks unrecoverable and spread deletion
authority across UI, storage and repositories.

## Decision

Revision Service owns the single document lifecycle transition. The caller
must provide the current revision ID, and the owner-scoped repository performs
an atomic compare-and-archive operation. Archived documents disappear from
normal list and read projections, while canonical revisions and audit history
remain durable. The UI always asks for explicit confirmation.

Physical purge and recovery UI are future retention operations. They must reuse
this lifecycle state rather than introduce a parallel delete path.

## Consequences

- A stale list cannot archive a document that has since changed.
- Existing editing, diagnostics, patch, evidence and export paths remain
  unchanged and cannot open an archived document.
- Stored source and evidence objects are not silently orphaned or prematurely
  erased by this operation.
- Migration 044 is required before the action is exposed in production.

## Verification

- `npm run test:grant-editor`
- `npm run test:grant-workspace-ui`
- `npm run check:grant-architecture`
