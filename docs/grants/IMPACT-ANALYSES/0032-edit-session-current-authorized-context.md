# Impact Analysis 0032: Current-authorized Edit Session Context

## Outcome

Allow each Edit Session turn to explicitly attach authorized local Evidence sources and imported figures. Authorization is rebuilt immediately before every model dispatch and checked again after the provider returns.

## Authority and data flow

- Evidence Authorization Service remains authoritative for excerpt transmission and reasoning.
- Figure Model Authorization Service gains a separate `useForAiEditing` purpose bit; semantic-diagnosis permission alone does not authorize editing.
- Model Data Gateway selects Evidence Cards, validates sensitivity, reads image bytes, verifies hashes, creates execution-local image references and dispatches the provider call.
- Session records store only program-owned authorization revisions, IDs and hashes; image bytes, excerpts and durable storage paths are not stored in Candidate telemetry.

## Revocation behavior

Authorization is checked before and after each call. Before a later turn, dependencies of the active Candidate are checked passively. Revocation, expiry, changed source/card hash, changed authorization revision or changed figure Revision marks the Candidate `needs_repair`; it cannot be the next semantic base.

No event listener or second authorization cache is introduced. Existing authorization records that predate `useForAiEditing` parse as false.

## Scope and rollback

This step supplies backend context admission only. UI attachment controls and production persistence/composition remain disabled. Rollback is to omit attachment IDs; text-only editing remains available and canonical content is unchanged.

