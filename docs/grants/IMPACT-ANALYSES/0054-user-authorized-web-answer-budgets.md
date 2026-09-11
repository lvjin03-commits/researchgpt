# Impact analysis: user-authorized resumable web-answer budgets

## Problem and evidence

- The current web-grounded Grant Assistant reserves a fixed 50-point ceiling
  for one atomic answer and records any calculated overage as platform-absorbed.
- A fixed user charge cap gives predictable trial pricing but does not bound
  provider spend and does not let a user choose between broader research and a
  smaller answer.
- Asking for more points only after a provider call would be too late: that
  call's cost has already occurred. Every paid decision, search, assessment and
  synthesis call therefore requires authorization and reservation before
  dispatch.
- Rejecting an increase must not discard paid search work. The user must still
  receive a bounded delivery assembled from the valid results already obtained.

This is a core billing and execution-state change, not a label or price tweak.
It changes the authority currently frozen by ADR 0051 and ADR 0052 and requires
an additive persistence design before runtime implementation.

## Ownership

- The site-wide Point Billing Service remains the only authority for prices,
  reservations, settlement, release and account balances.
- A single future resumable web-answer budget coordinator will own phase
  admission, pause/resume state and the invariant that no provider call starts
  without enough authorized budget.
- Operation Registry and its versioned Policy remain authoritative for per-call
  input/output token limits, tool-call limits, attempt limits, timeout and
  billable-usage bounds. The browser and model cannot alter those limits.
- Grant Model Data Gateway remains authoritative for current document and
  Evidence admission. Revision Service and Patch Commit Service are unchanged.
- The user alone authorizes an initial budget or an increase. The model may
  propose useful next work, but cannot authorize spend or assign prices.

Downstream routes and UI may display coordinator state, but must not recompute
available budget, infer authorization from wording or settle a charge.

## Target contract

### Authorized budget

One logical web-grounded turn has an immutable initial authorization and zero
or more explicit increase authorizations. Each record contains a program-owned
identity, actor, document, turn, authorized point amount, policy version,
timestamp and idempotency key. The effective authorized total is their sum.

The initial authorization is divided into three hard-bounded envelopes:

1. `decision`: optional bounded model planning needed to choose further work;
2. `execution`: query rewrite, web search, source assessment and additional
   coverage work;
3. `delivery`: one no-tool synthesis from already persisted valid artifacts.

Decision and delivery are distinct even if their reservations share one
physical reserve operation. Decision work cannot consume the delivery envelope.
The delivery envelope is reserved before the first provider call and remains
available until terminal delivery or an explicit terminal failure.

Before every paid call the program must prove atomically:

```text
settled points
+ active call maximum
+ remaining admitted decision maximum
+ delivery hard maximum
<= user-authorized points
```

The active call is also constrained by its Operation Policy. A usage estimate,
historical percentile or model claim is not sufficient authorization.

### States

The future aggregate has exactly these business states:

- `running`: one admitted phase may execute;
- `awaiting_budget`: no provider call may run; an increase or bounded delivery
  decision is required;
- `delivering_existing_results`: the reserved no-tool delivery is executing;
- `delivered_complete`: the user's request is reported complete;
- `delivered_partial`: valid existing results were delivered with explicit
  coverage limitations;
- `failed_no_delivery`: no usable model delivery exists; a deterministic
  artifact manifest and billing outcome remain readable;
- `expired`: the 48-hour decision window elapsed and unused reservations were
  released.

Provider retries are not states. They consume the owning Operation Policy's
attempt budget and require admission under the same authorization invariant.

### Budget-increase decision

When the next useful phase cannot be admitted, the coordinator persists
`awaiting_budget` before returning control to the user. The projection contains
only program-owned facts: completed stages, valid artifact count, uncompleted
coverage dimensions, settled points, still-reserved delivery points and the
maximum amount required for the proposed next phase.

`continue` requires an explicit point amount and creates an idempotent increase
authorization before reservation or dispatch. `deliver_existing` creates no
new execution authorization and enters the reserved delivery phase. Silence,
new chat prose, page refresh and model output cannot mean consent.

### Delivery guarantee and fallback

The delivery Operation has a versioned hard maximum for input tokens, output
tokens, one provider attempt, zero tools and zero search calls. Its prompt may
use only persisted artifacts admitted for the current delivery.

If this bounded model delivery fails, a deterministic renderer must still
return a minimal artifact manifest containing source titles and URLs, completed
assessment labels, missing coverage and settled-point facts. The renderer does
not synthesize scientific conclusions. A deterministic manifest is a recovery
artifact, not a successful model answer, and incurs no new provider charge.

`delivered_partial` is billable for valid work actually delivered under the
accepted policy. Unused reservations are released. Provider failures,
duplicate attempts and other non-deliverable work follow the existing terminal
state policy and cannot be relabeled as an authorized increase.

### Pause, expiry and account projection

- `awaiting_budget` lasts 48 hours from the persisted pause timestamp.
- Only the delivery hard maximum remains reserved while paused; future
  execution capacity is not frozen.
- The account projection identifies the reservation as a paused web-answer
  task and links to its owner-scoped continuation route.
- Expiry releases unused reservation through the existing ledger/reconciliation
  authority and preserves auditable stage artifacts under the applicable
  retention policy. UI code never edits balances or expires a task directly.
- A later continuation after expiry is a new authorization decision; it cannot
  revive released funds implicitly.

### Revision and authorization drift

Persisted artifacts carry dependency fingerprints. On resume:

- public search queries, source snapshots and deterministic source trust tiers
  may be reused when their own content/version remains valid;
- document-relative relevance assessments are invalid when affected canonical
  node hashes or the source Revision have changed;
- synthesis and edit recommendations based on an older Revision are marked
  stale and cannot be presented as current analysis;
- Evidence-dependent artifacts require current authorization and fingerprint
  equality before reuse;
- any required recomputation is a new phase subject to budget admission.

The coordinator invalidates only dependent artifacts; it does not discard
independent paid search work or bypass existing Revision/Patch rules.

## Expected scope

Later implementation is expected to change the existing billing coordinator,
web-grounding orchestrator, Operation Policies, Grant Assistant route and UI,
and add persistence/RPCs for authorization, phase state and artifact
dependencies. It must extend the current route and ledger rather than create a
parallel chat or wallet.

The fixed `GRANT_WEB_USER_CHARGE_CAP_POINTS = 50` behavior remains the deployed
compatibility path until all target contracts are implemented, migrated and
explicitly rolled out. It must then be removed, not retained as a second budget
authority.

No schema migration, runtime selection, production configuration, provider
call or user-facing behavior changes in this contract-only step.

## Security and privacy

- Paused artifacts remain owner- and document-scoped.
- Persisted search data continues to exclude large webpage bodies and sensitive
  query material prohibited by the egress policy.
- Account projections expose no grant prose or private source snippets.
- Resume rebuilds current Model Data Gateway admission; persisted authorization
  is evidence for audit, never authority for a new call.

## Migration and rollback

- Persistence must be additive and the new runtime default-off.
- Rollout requires schema readiness plus an owner-stable Canary.
- Before activation, rollback is no-op because production retains fixed atomic
  delivery.
- After activation, rollback stops new resumable turns and allows existing
  paused turns to choose bounded delivery or expire; it must not strand a
  delivery reservation or make historical billing unreadable.
- Removal of the fixed-cap path requires verified recovery, expiry, accounting
  reconciliation and signed-in Canary delivery.

## Verification plan

Contract tests must prove:

- every decision/provider/tool call is rejected before dispatch without enough
  authorized and reserved budget;
- the delivery hard maximum cannot be consumed by decision or execution work;
- normal completion charges actual delivered usage and releases unused reserve;
- budget exhaustion persists `awaiting_budget` with zero unapproved calls;
- an idempotent increase resumes from the exact checkpoint without duplicate
  search or charge;
- declining an increase produces bounded partial delivery;
- model-delivery failure produces the deterministic manifest without fabricated
  conclusions;
- document/evidence drift invalidates dependent artifacts only;
- concurrent continue/decline/expiry actions have one terminal outcome;
- 48-hour expiry releases unused reserve and remains visible in account audit;
- runtime rollback leaves paused reservations recoverable.

Real user-path verification will require an explicitly authorized paid Canary
run for normal completion, pause/increase/resume and decline/partial delivery.
None is performed in this step.
