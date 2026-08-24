# ResearchGPT Point Billing Implementation Plan

## Delivery Sequence

| Step | Deliverable | Status |
|---|---|---|
| 1 | Commercial rules, impact analysis and single-authority ADR | Complete |
| 2 | Atomic account, lots, reservations, append-only ledger and CI contracts | Implemented locally; migration not applied |
| 3 | Shared Operation IDs, standardized usage and Edit Session billing contract | Implemented locally |
| 4 | Price catalog, deliverability matrices, estimate/reserve/settle service | Implemented locally |
| 5 | Existing AI feature integration | Meter-only integration implemented locally; charging remains disabled |
| 6 | Payment provider and manual incident runbook | Provider-neutral ingress and test provider implemented locally; real merchant adapter not configured |
| 7 | Automated reversal and risk controls | Implemented locally; production policy and provider remain unconfigured |
| 8 | Statements, reconciliation and canary charging | Control plane implemented locally; no production canary activated |

## Step 2 Exit Evidence

- `lib/billing/domain/contracts.ts` defines integer balances, separate point
  sources, reservations, immutable transactions and recovery shortfalls.
- `lib/billing/ports/point-ledger-repository.ts` is the sole persistence port.
- Memory and Supabase adapters implement the same mutation contract.
- Migration `059_site_wide_point_ledger.sql` owns database-atomic grants,
  reservations, settlement, release and zero-floor reversals.
- `npm run test:point-ledger` verifies concurrency, duplicate grants,
  idempotent finalization, partial settlement, release and insufficient
  reversal behavior.
- `.github/workflows/ci.yml` runs the ledger contract on every pull request and
  push to `main`.

## Step 2 Remaining Deployment Gate

Migration `059` is additive but has not been applied to any remote database.
Production migration and a real PostgreSQL concurrency probe require separate
authorization. No point account is created and no user-visible behavior changes
until a later runtime integration step is approved.

## Step 3 Exit Evidence

- `lib/ai/operation-registry.ts` is the shared executable operation identity
  owner for chat, Document V2 and Grant AI calls.
- `lib/ai/billable-usage.ts` represents token, tool, image, audio and video
  usage without pricing or balance authority.
- Existing Document V2 operation values are preserved while their contracts
  reference the shared registry.
- Grant assistant and Edit Turn constants reference the shared registry.
- `lib/grants/edit-session/billing-contract.ts` defines one independent Bundle
  per explicit Edit Turn and marks non-model session/application actions free.
- `npm run test:ai-operation-contracts` is required by CI.

## Step 4 Exit Evidence

- `lib/billing/domain/price-catalog.ts` performs exact integer cost/point math,
  quotes each Bundle and owns the confirmation threshold.
- `lib/billing/domain/deliverability.ts` exhaustively maps every accepted
  terminal state for every registered Operation; unknown states release.
- `lib/billing/application/point-billing-service.ts` resolves immutable price
  versions, atomically reserves Bundle sets and settles only delivered usage.
- Migration `060` stores immutable policies and provides one transactional
  multi-Bundle reservation RPC. It seeds no production price.
- Reasoning tokens remain audit data and cannot be double-priced as output.
- `npm run test:point-billing-engine` is required by CI.

## Step 5 Exit Evidence

- Chat, Document V2, Grant assistant chat and Grant Edit Turn successful model
  calls emit the shared standardized usage envelope.
- Existing bounded-context logs remain intact; the cross-site event stream does
  not calculate price or decide deliverability.
- `AI_POINT_BILLING_MODE` accepts only `disabled` and `meter_only`. An
  `enforced` value fails configuration validation and cannot silently enable
  deduction.
- Chat tool counters are projected as standardized tool-call usage.
- Grant Edit Turn now preserves the provider token usage that was previously
  discarded between its model adapter and executor.
- Migration `061` enriches `ai_usage_events` with Operation, provider,
  billing-operation identity, attempt and standardized usage fields.
- `npm run test:ai-billing-integration` is required by CI.

## Step 5 Remaining Charging Gate

Grant multi-stage diagnosis is not charged per low-level provider call: Fact
Map is internal while scientific and narrative results are separate delivery
Bundles. Reservation and settlement must be connected at that aggregate
delivery boundary during canary charging. Image generation and other
non-token assets remain deferred until provider usage units are authoritative.

No real deduction can occur until migrations 059-061 are applied, price
policies and point accounts exist, checkout and estimates are visible, and an
explicit step-eight canary authorizes an `enforced` runtime mode.

## Step 6 Exit Evidence

- The server derives CNY minor-unit amount and launch bonus from an arbitrary
  whole-point purchase request under frozen policy versions.
- Payment Provider and Payment Repository ports isolate provider checkout and
  raw-body webhook verification from the Point Ledger.
- Migration `062` stores pending orders and sanitized verified events. Its
  `confirm_point_payment` transaction verifies provider, merchant, provider
  order, amount and currency before granting separate purchased and bonus lots.
- Provider event identity is unique and repeat delivery returns the existing
  order/account without another grant.
- The signed test provider is forbidden when the runtime environment is
  production.
- `PAYMENT-INCIDENT-RUNBOOK.md` defines the manual safety procedure required
  before the first minimal real payment.
- `npm run test:point-payment-contracts` is required by CI.

## Step 6 Remaining Live-Payment Gate

A real payment provider and merchant settlement account have not been selected
or configured. There is no production checkout API or UI, no public payment
copy, and migrations 059-062 remain unapplied. Live payment additionally
requires provider-official signature verification, named incident contacts,
legal review, PostgreSQL concurrency probes and explicit deployment approval.

## Step 7 Exit Evidence

- Verified `payment_reversed` and `chargeback` events route automatically to
  one transactional payment-reversal RPC.
- Bonus and purchased lots receive compensating reversals; available balance
  stops at zero and unrecovered consumption becomes an auditable shortfall.
- Any shortfall moves the account to `risk_hold`, and the existing ledger
  rejects new reservations for held accounts.
- Duplicate and concurrent reversal events recheck identity after the order
  lock and cannot reverse twice.
- Checkout risk evaluates account, hashed device, hashed network and optional
  hashed payment-method dimensions under one versioned policy.
- Advisory transaction locks prevent simultaneous requests from bypassing
  velocity or amount limits.
- Raw IP, device and payment identifiers fail the hashed-context contract.
- `npm run test:payment-risk-controls` and the extended payment contract are
  required by CI.

## Step 7 Remaining Production Gate

Migration `063` is not applied. Production thresholds, hash-key rotation and
retention policy are not configured. Automated events cannot run until a real
provider adapter is selected and its official reversal event/signature
contract is implemented and verified.

## Step 8 Exit Evidence

- User statements are owner-checked, cursor-paginated read projections of the
  append-only ledger and expose grants, holds, charges, releases and reversals.
- Provider reconciliation is bidirectional and reports provider-only,
  internal-only, amount and status mismatches.
- Internal reconciliation reports missing payment events/lots, grant mismatch,
  available-balance divergence and reserved-balance divergence.
- Reconciliation has no mutation port and cannot repair financial state.
- Canary policy requires explicit owner and Operation allowlists, expiry,
  version and per-owner rolling daily ceiling; unrestricted `enforced` is not a
  valid mode.
- The single-Bundle coordinator requires quote/confirmation/reservation before
  provider dispatch, charges only delivered usage, and releases failed output.
- A settlement persistence error retains its reservation for reconciliation
  rather than guessing that release is safe.
- `CANARY-CHARGING-RUNBOOK.md` defines prerequisites, first charged path and
  automatic-stop conditions.
- `npm run test:billing-canary` is required by CI.

## Step 8 Remaining Deployment Gate

This completes the local control-plane sequence, not commercial launch.
Migrations 059-064 are unapplied; statements have no UI/API route; no real
provider, price rows, funded production canary account or charging policy is
configured. Existing feature routes remain meter-only. Grant semantic
diagnosis still requires its explicit two-Bundle charging adapter. Production
activation, commit and deployment require separate authorization and real
user-path verification.
