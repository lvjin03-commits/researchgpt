# Impact analysis: web-grounded canary charge guard

## Scope

- Connects the existing four-stage atomic billing coordinator to the existing
  Grant Assistant web-grounding composition through one adapter; it adds no
  route, provider, content model or alternate answer pipeline.
- Charging remains disabled by default. Accounts outside an unexpired explicit
  Canary policy execute the existing metered, zero-point path without reading
  the price catalog or reserving points.
- An eligible Canary account is checked before provider dispatch. Missing
  balance, risk hold, the 50-point per-answer ceiling, the configured daily
  ceiling and missing price policies all stop execution before a paid call.
- A completed answer settles observed delivered usage. Any fallback or thrown
  failure releases the entire four-stage reservation set.

## Authority and data flow

- The site-wide point ledger remains the only authority for account state,
  reservation and settlement.
- The site-wide price catalog remains the only authority for charge conversion.
- The Grant adapter supplies operation identities, IDs, approved usage ranges
  and the final deliverability state; it does not calculate or mutate balances.
- The web-grounding orchestrator accepts caller-owned billing operation IDs so
  reservation and measured provider usage share the same identities.

## Rollout and rollback

- Production charging requires migration 069 plus a separately authorized,
  expiring `AI_POINT_CHARGING_POLICY_JSON` Canary policy.
- Clearing or changing that policy to `disabled` immediately restores the
  existing zero-point path without removing metering or source traceability.
- This change does not apply a migration, enable a Canary, deploy or make a paid
  OpenAI request.

## Verification

- Offline tests prove non-Canary bypass, successful reserve/settle, and zero
  provider dispatch for insufficient balance, risk hold, per-answer cap and
  daily cap.
- Existing Grant Assistant and web-grounding orchestration tests remain green.
- TypeScript, encoding and Grant architecture checks pass.
- Production balance responses, real ledger RPCs and visible UI behavior remain
  unverified until migration and Canary rollout are explicitly authorized.
