# ResearchGPT Point Billing Architecture

## Status

- Governance contract: accepted for implementation planning.
- Atomic ledger foundation: implemented locally in migration `059`, shared
  domain/repository contracts and CI-enforced in-memory concurrency tests.
- Runtime AI metering and guarded single-Bundle canary coordinator:
  implemented locally; no production canary or feature-route charging enabled.
- Real-money payment: not authorized by this document and remains disabled.
- Provider-neutral payment ingress: implemented locally; no live merchant
  adapter, checkout route or production migration is enabled.
- External refund wording, purchased-point expiry and mandatory refund rights:
  pending professional legal review.

## Product Boundary

ResearchGPT uses `智点` as one site-wide unit for metered AI consumption. It is
not a Grant-only currency and it does not represent a fixed number of provider
tokens. Different models, cached inputs, outputs and tools have different
provider prices; the billing system converts standardized usage into points.

Non-AI document ownership, viewing, manual editing and ordinary saving do not
become billable merely because the point system exists. Each future billable
capability must register an explicit Operation and billing contract.

## Authoritative Owners

| Decision | Authoritative owner | Rule |
|---|---|---|
| AI Operation identity | Site-wide AI Operation Registry | Billing cannot invent a second operation name |
| Raw provider usage | Existing model executor and usage telemetry | Usage reporters never calculate or deduct points |
| Provider/tool prices | Versioned Price Catalog | Historical events retain their frozen price version |
| Estimate and maximum user charge | Point Billing Service | Feature modules cannot publish handwritten estimates |
| Point balance, reservation, settlement and reversal | Point Ledger | All changes are atomic, append-only and idempotent |
| Payment status | Payment Service | Browser redirects never prove payment success |
| Point grant after payment | Point Billing Service | Only a verified, committed payment event can grant points |
| Deliverability of AI output | Registered Operation billing contract | Models and payment adapters cannot self-declare billability |
| Legal refund/expiry wording | Approved legal policy version | Product code must not invent or hard-code legal conclusions |
| User statement | Point Ledger projection | Statements never recalculate balances from feature data |
| Reconciliation conclusion | Billing Reconciliation Service | Reports differences only; never repairs financial records |
| Charging rollout eligibility | Versioned Canary Policy | Requires explicit owner and Operation allowlists; features cannot self-enroll |

`ai_usage_events` and `grant_model_calls` remain factual telemetry. Neither is a
wallet, price catalog or charging authority. They may be adapted into the
standardized usage contract, but they cannot update a point balance directly.

## Dependency Direction

```text
Feature / Operation
  -> standardized usage and terminal state
  -> Point Billing Service
      -> Operation Registry
      -> Price Catalog
      -> Point Ledger
      -> Payment port

Provider adapters -> usage telemetry
Payment adapters  -> verified payment events
```

Feature code must not import payment-provider SDKs, update point tables, choose
a price multiplier or reinterpret a billing terminal state.

## Failure Boundary

Provider cost is not automatically user charge. Only a result accepted by the
program-owned deliverability contract and actually made available to the user
may settle reserved points.

Billing failure is fail-closed for new paid AI dispatches:

- already reserved work may finish and settle through its frozen policy;
- new paid model work does not bypass the ledger;
- viewing, manual editing, saving and other non-AI behavior remains available;
- there is no unmetered free fallback hidden behind a billing outage.

## No Parallel Authority

No Grant, literature, chat, image or future feature may own a private wallet,
point conversion formula, price table, reservation flow or payment callback.
Adding a new AI capability requires registration with the shared Operation and
billing contracts rather than another charging path.
