# Impact Analysis 0028 — User-directed single-node AI Patch

## Change

Allow a user to select one editable canonical node and give a free-form revision
instruction without first selecting a diagnostic Finding. The user may replace
that node or ask for one new paragraph immediately after it. The request reuses
the existing Patch Service, proposal contract, preview, acceptance and Revision
CAS path. It adds no route, renderer, repository or write authority. New node
identity, section membership and order are assigned by the program, not the
model.

The same Patch Policy also rejects unsupported factual additions. Without an
authorized Evidence Card, a replacement cannot introduce a new numeric claim,
citation marker, reference entry, experimental result or prior-achievement
claim. Validation runs both when the proposal is created and immediately before
acceptance.

## Authorities affected

- Patch scope remains owned by Patch Policy and is still exactly one target or
  anchor node plus at most one program-created paragraph in the same section.
- Canonical writes remain owned by Revision Service.
- Evidence admission remains owned by Grant Model Data Gateway and Evidence
  Authorization Service.
- The model still proposes replacement text only; it does not decide whether a
  factual addition is safe to commit.

## Compatibility and rollback

Finding-driven Patch requests remain unchanged because `findingId` was already
optional in the existing service and route contract. Removing the free-edit UI
entry restores the previous visible behavior. Removing the additive fact-risk
validator restores the prior Patch Policy; no schema or stored-data rollback is
required.

## Risks and controls

- Stale edit: existing Revision CAS and target-text hash reject it.
- Duplicate acceptance: existing proposal audit recovery and accepted status
  make acceptance idempotent.
- Scope expansion: Patch Policy permits only replacement or one insertion after
  the authorized anchor; the model cannot choose a node ID or section.
- Fabricated content: deterministic old/new-text checks reject unsupported new
  factual markers at proposal creation and acceptance.
- False positives: checks compare only markers newly introduced by the model;
  existing numbers and factual language may be preserved.

## Verification boundary

Contract tests cover the free request, stale Revision, duplicate acceptance and
fact-risk rejection. UI contracts cover the new entry and saved-only gate. A
real signed-in click, provider response preview and accepted Revision remain
required before production completion is claimed.
