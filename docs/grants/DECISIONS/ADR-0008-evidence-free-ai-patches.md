# ADR-0008: Evidence-free AI patch proposals

- Status: accepted
- Date: 2026-08-08

## Context

PR5 adds local AI-assisted revision to the grant workspace. It must not create a
second canonical writer, use unapproved evidence, or let model output choose the
write scope.

## Decision

The Grant Model Data Gateway is the only owner of model context. In PR5 it sends
only the current target node, its section context, the selected diagnostic
finding, and the user's instruction. Evidence is always empty.

The model returns replacement text only. The program owns proposal IDs, target
node IDs, base revision IDs, old text, text hashes, and patch operations. The
Patch Commit Service validates scope and freshness, then delegates the only
canonical write to Revision Service compare-and-swap. A proposal never changes
canonical content until the user explicitly accepts it.

The feature is protected by `GRANT_AI_PATCH_ENABLED` and defaults to disabled.

## Consequences

- Existing editing, diagnostics, imports, and Document V2 remain unchanged.
- PR5 cannot use local or online literature; evidence authorization is PR6.
- Initial patch scope is one heading or paragraph node per proposal.
- Proposal status is a durable projection; the revision audit event is the
  authoritative acceptance record and supports idempotent recovery.

