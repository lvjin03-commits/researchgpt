# Canary Charging Runbook

This runbook is a deployment gate, not authorization to charge production
users.

## Preconditions

- migrations 059 through 064 applied and probed on the target database;
- real provider checkout and webhook signatures verified with official tools;
- active immutable price policies for every canary Operation/model pair;
- statement and reconciliation functions return no internal invariant finding;
- funded canary accounts and explicit participant consent;
- user interface shows likely range, hard maximum and confirmation when needed;
- named payment/on-call contacts and approved legal/privacy copy;
- `AI_POINT_BILLING_MODE=meter_only` has accumulated enough usage to validate
  expected ranges before any charged dispatch.

## Canary Policy

Configure one JSON policy with:

```json
{
  "mode": "canary",
  "ownerIds": ["explicit-user-uuid"],
  "operations": ["one.registered.operation"],
  "maximumDailyChargePointsPerOwner": 500,
  "expiresAt": "future ISO timestamp",
  "policyVersion": "canary-YYYYMMDD-v1"
}
```

There is no unrestricted `enforced` mode. Expired, unlisted-owner and
unlisted-Operation traffic remains meter-only.

## First Charged Path

1. Start with one internal account and one single-Bundle Operation.
2. Verify quote range and maximum against the frozen price policy.
3. Confirm reservation appears before the provider request.
4. Verify a delivered result settles actual usage below the maximum.
5. Force a provider failure and verify full release.
6. Force an unknown terminal state and verify release plus alert.
7. Read the user statement and match reservation, settlement/release and final
   balance.
8. Run provider and internal reconciliation before expanding the allowlist.

## Automatic Stop / Manual Kill Switch

Immediately replace the policy with `{"mode":"meter_only"}` when any of these
occurs:

- balance, lot, reservation or payment invariant finding;
- duplicate or unexplained charge;
- settlement outcome unknown beyond the reservation expiry response target;
- provider settlement mismatch;
- charge/release differs from the user-visible result;
- abnormal output failure or payment reversal rate;
- statement unavailable to a charged participant.

Do not delete or rewrite affected records. Preserve reservations with unknown
settlement outcome for reconciliation. Rollback disables new charging only;
already committed ledger history remains visible.
