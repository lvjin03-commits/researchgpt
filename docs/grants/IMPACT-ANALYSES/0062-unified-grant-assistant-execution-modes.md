# Impact analysis: Unified Grant Assistant execution modes

## Problem and Evidence

The memory-planned assistant and `answerFullDocumentAssistantChat` independently
owned full-document behavior. A short document could be sent in one complete
prompt while a long document used hierarchical analysis. The split allowed
different token admission, source typing and audit behavior for the same user
intent, and invited local capacity patches.

## Ownership

- The semantic planner proposes document and diagnostic access.
- The Memory Pipeline deterministically maps validated access to one of three
  execution modes and is the only execution-mode owner.
- The Context Budget Planner admits exact provider messages before every unit
  and synthesis call.
- The hierarchical executor owns complete section/node coverage and aggregate
  request/usage reporting; it does not own source authorization or billing.
- The canonical Revision owns original text.
- The grounded-answer validator remains the sole final citation-binding check.

## Scope and Compatibility

No API route, UI control, canonical model, persistence table or write authority
is added. The old gateway method is removed rather than retained as a fallback.
`documentAccess=full_original` keeps its public planning meaning, but its runtime
meaning is now always hierarchical. Existing stored memories remain governed by
the Step 2 v2 contract and policy version.

## Risks and Controls

- **Excess calls:** operation policy caps units, sections per unit and outputs.
- **Hidden token drift:** request builders are shared by budgeting and provider
  dispatch; every actual unit and synthesis request is admitted.
- **Incomplete review:** construction fails unless units cover every canonical
  section and node.
- **Citation inflation:** final context contains only aliases actually cited by
  synthesis, resolved to original text or current diagnostics.
- **Parallel path regression:** the deleted gateway method must remain absent.

## Rollout and Rollback

This step needs no database migration. Rollout uses the existing assistant flag
and schema marker 074. Rollback is a code rollback of the single pipeline; it
must not restore the deleted parallel gateway method. Production rollout and a
real paid-provider smoke test require explicit authorization.
