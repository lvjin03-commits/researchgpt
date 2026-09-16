# Impact analysis 0068: hierarchical synthesis and truthful partial delivery

## Problem

Validated full-document review units could still exceed the capacity of one final synthesis
request. A later synthesis or provider failure also discarded already completed, grounded unit
analysis and surfaced the turn only as a generic failure.

## Authority and boundary changes

- The existing hierarchical-review executor remains the only owner of full-review decomposition,
  reduction and final synthesis. No second route or content model is introduced.
- Oversized unit analyses are reduced through deterministic, bounded synthesis levels before the
  final synthesis request.
- Validated reduction results are checkpointed with deterministic hashes and may be resumed by the
  existing execution controller.
- When an eligible transient, capacity or structured-output failure occurs after at least one unit
  completed, the review wrapper may return only those validated units as an explicitly partial
  answer. Refusal, content filtering, model-contract and internal-integrity failures remain fatal.
- Context coverage metadata is authoritative and is persisted beside the result so a resumed turn
  cannot relabel a partial review as complete.

## Data, billing and safety

- Partial answers cite only canonical original nodes or current diagnostic records already admitted
  by the grant model-data gateway.
- A partial answer states its covered and total unit counts and that final synthesis did not finish.
- Completed checkpointed work is reused and is not charged again by a resumed execution. Newly
  dispatched reduction or synthesis calls remain attributable through the existing model-call
  ledger.
- The change does not write canonical grant content and does not change evidence authorization.

## Compatibility and rollout

- The execution checkpoint JSON gains optional reduction and context-coverage fields; migration 076
  already stores the checkpoint as JSON, so no additional migration is required.
- Older checkpoints without coverage remain readable and use the existing conservative default.
- Application deployment still depends on migration 076 being applied first.

## Verification

- Offline tests exercise multi-level reduction, impossible reduction capacity, stage-local recovery,
  partial delivery and saved-unit reuse.
- Type checking, Grant architecture checks and the full Grant CI suite are required.
- No paid-provider or production verification is performed without separate explicit authorization.
