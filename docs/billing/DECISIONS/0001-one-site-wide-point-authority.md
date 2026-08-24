# ADR 0001: One Site-wide Point Billing Authority

## Status

Accepted for staged implementation. Real-money rollout is not authorized.

## Context

ResearchGPT has multiple AI bounded contexts and two existing factual usage
stores. Future text, retrieval, image, audio and video capabilities need one
commercial unit without forcing users to understand provider-specific token
prices. Charging inside each feature would duplicate wallets, pricing,
reservations and failure semantics.

## Decision

ResearchGPT will use one site-wide `智点` account and Point Billing Service.

- `100` points represent `CNY 1.00` of ResearchGPT AI usage credit.
- Initial standard markup is `50%` over the frozen provider/tool cost.
- The initial `13%` bonus is a versioned campaign and rounds down to whole
  points.
- Users may purchase a server-validated positive whole number of points rather
  than only fixed packages.
- A point is not a fixed number of provider tokens.
- Features and telemetry report standardized factual usage only.
- The Price Catalog alone converts usage to frozen provider cost.
- The Point Billing Service alone estimates, reserves, settles, releases and
  reverses points.
- Provider cost becomes user charge only after program-owned deliverability
  validation.
- New paid AI dispatch fails closed when the billing authority is unavailable.
- Payment success is accepted only from a verified server-side provider event.
- Purchased, purchase-bonus and promotional-trial grants remain separate lots.
- The initial product has no user self-service refund flow. This does not waive
  mandatory legal or payment-channel rights; final wording awaits legal review.

## Consequences

- Every present and future AI capability must register an Operation, usage
  type, price policy and deliverability contract.
- Existing `ai_usage_events` and `grant_model_calls` remain usage/audit facts
  and do not become wallets.
- Payment, price and ledger schemas must preserve immutable policy snapshots.
- A payment order remains linked to granted lots even without self-service
  refunds because forced reversals and reconciliation still require provenance.
- Non-AI product behavior remains independent of billing availability.
- Real payment cannot be enabled until the staged ledger, pricing, settlement,
  payment, risk and user-path gates pass.

## Alternatives Rejected

- Feature-specific point systems.
- Fixed token-to-point conversion.
- Charging raw provider attempts.
- An unlimited free fallback when billing is unavailable.
- Treating a browser return URL as payment confirmation.
- Removing payment-lot provenance because self-service refunds are absent.

## Follow-up

1. Implement the atomic ledger with CI-enforced concurrency contracts.
2. Bind billing operation IDs to the shared AI Operation Registry.
3. Freeze Edit Session and non-token usage contracts.
4. Implement deliverability matrices, pricing, reservation and settlement.
5. Integrate existing AI features before real payment.
6. Obtain legal review before publishing refund/expiry terms.
