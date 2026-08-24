# Impact Analysis 0007: Statements, Reconciliation and Canary Charging

## Decision

Complete the local billing control plane without enabling production charging.

- User statements are read-only projections of the Point Ledger.
- Reconciliation compares provider settlement facts, payment orders, point lots
  and ledger invariants. It reports discrepancies and never repairs balances.
- Canary charging requires an expiring owner allowlist, Operation allowlist,
  daily point ceiling, active price policy, funded active account and explicit
  confirmation when the existing threshold requires it.

## Canary Safety

`disabled` and `meter_only` remain accepted rollout modes. `canary` is accepted
only with non-empty, valid UUID/Operation allowlists and a future expiry. There
is no unrestricted `enforced` mode in this step.

For an eligible single-Bundle operation:

1. resolve the frozen price and display quote;
2. require confirmation when the shared threshold says so;
3. reserve the hard maximum before provider dispatch;
4. execute the existing model path;
5. settle only programmatically delivered usage;
6. release on rejected, failed, stale, unknown or thrown execution.

Non-eligible users remain meter-only during a canary. A billing outage blocks a
new charged dispatch rather than silently running it free.

Grant semantic diagnosis remains excluded from the generic single-Bundle
coordinator. Its scientific/narrative delivery Bundles require an explicit
aggregate adapter and real user-path verification before inclusion.

## Reconciliation Boundary

Provider settlement input is factual and untrusted until matched. Reconciliation
may report missing orders, amount/status mismatches and internal ledger
invariants. It cannot mark payments paid, grant points, reverse lots or clear a
risk hold.

## Deployment Boundary

No live price rows, canary allowlist, payment provider, checkout UI or production
migration is supplied. Migration 064 and all prior billing migrations remain
unapplied. Production activation is a separate authorized deployment decision.
