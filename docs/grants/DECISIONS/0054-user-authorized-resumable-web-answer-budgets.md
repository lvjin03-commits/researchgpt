# ADR 0054: User-authorized resumable budgets for web-grounded answers

- Status: accepted target; not implemented
- Date: 2026-09-11
- Owners: Site-wide Point Billing Service; resumable web-answer budget coordinator
- Supersedes: ADR 0051 fixed 50-point user ceiling and ADR 0052 single atomic-answer reservation, after migration and rollout
- Superseded by: none

## Context

The deployed Canary reserves one fixed 50-point envelope for query rewrite,
search, source assessment and synthesis. User charges are capped at 50 while
calculated overage is platform-absorbed. That policy neither lets a user select
research depth nor strictly limits platform spend.

An increase requested after an external call cannot authorize cost already
incurred. Conversely, declining an increase must not discard useful source work
already completed under a valid authorization.

## Decision

One existing Grant Assistant web-grounded turn will become a persisted,
resumable budget aggregate. The user explicitly authorizes the initial point
budget and every increase. A program-owned coordinator admits each paid phase
only after an atomic pre-dispatch budget and reservation check.

The authorization contains separate hard envelopes for optional decision work,
execution work and final delivery. Decision work cannot consume the delivery
envelope. The final delivery is one no-tool, one-attempt Operation with fixed
input/output token ceilings. A deterministic, non-semantic artifact manifest is
available if model delivery fails.

If useful next work cannot fit, the aggregate persists `awaiting_budget` and
makes no further provider call. The user may explicitly increase the budget or
request delivery from current results. Declining an increase remains billable
for valid work actually delivered; unused reservations are released.

Paused tasks retain only the final-delivery reserve and expire after 48 hours.
Account UI projects that reservation and links back to the task. Expiry and
release remain ledger-owned.

Resume revalidates Revision, affected node hashes, source fingerprints and
Evidence authorization. Independent search artifacts remain reusable; stale
document-relative assessments and synthesis do not. Recalculation requires new
budget admission.

Operation Registry Policy remains the only owner of per-call token, tool,
attempt and timeout ceilings. Models can recommend a next step but cannot
authorize spend, assign a price, change limits or select a terminal state.

## Alternatives considered

- Keep fixed 50-point charging and absorb all overage: rejected as the long-term
  target because it hides platform exposure and offers no user-selected depth.
- Spend until the cap is crossed and ask afterward: rejected because consent
  cannot retroactively authorize provider cost.
- Use a planning model before checking any budget: rejected because planning is
  itself billable. It requires its own pre-authorized decision envelope.
- Release all funds while paused: rejected because it would break the promise
  that declining an increase can still produce a bounded delivery.
- Invalidate every artifact on document change: rejected because public search
  work can remain valid independently of the document-relative analysis.
- Add a second web-chat route or wallet: rejected because the existing Grant
  Assistant and site-wide Point Billing Service retain authority.

## Impact analysis

- User-visible behavior: editable initial budget, explicit increase/partial-
  delivery choice, paused-task recovery, actual settled usage and limitations.
- Affected modules: existing web-grounding coordinator and orchestrator,
  Operation Policy, point reservation projection, Grant Assistant route/UI and
  additive persistence.
- Data/schema impact: future owner-scoped authorizations, phase/checkpoint state,
  artifact dependency fingerprints and idempotent transition RPCs.
- Security/privacy: no new data provider; resume must rebuild current data
  admission, and account views contain no grant content.
- Compatibility: fixed 50-point atomic behavior remains until the new path is
  complete and Canary-verified, then is removed.
- Rollback: stop new resumable turns; permit paused turns to deliver or expire;
  preserve ledger and audit readability.

## Verification

The required contract and real-path cases are specified in Impact Analysis
0054. This decision changes documentation only. No database, runtime, UI,
production configuration or paid model call is authorized by this step.
