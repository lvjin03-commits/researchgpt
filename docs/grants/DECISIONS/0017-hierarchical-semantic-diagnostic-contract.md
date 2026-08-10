# ADR-0017: Hierarchical semantic diagnosis identity and responsibility

## Status

Accepted and implemented behind a fail-closed server rollout gate. Production
behavior remains on the active Semantic V4 path until migration 047, canary
activation and effect-first verification are separately authorized.

## Context

Direct full-document Finding generation tends to report local symptoms without
first making the application's argument explicit. A two-stage review can first
reconstruct the stated argument, then diagnose root gaps and connect their
occurrences. However, a model-generated ArgumentMap is not stable enough to own
cross-run identity, and exposing canonical UUID pairs would reintroduce a known
reference-composition failure.

## Decision

- The existing `AI诊断` semantic checker remains the single authority and will
  eventually execute two internal operations: descriptive argument mapping and
  root diagnosis.
- ArgumentMap is a revision-bound scaffold. It may be a durable resume
  checkpoint, but its role labels, ordering, statements and provider-facing
  references do not become Finding identity.
- Step A describes presence, source locations and stated relations only. It
  cannot diagnose, recommend, assign severity, prioritize or predict funding.
- Each model-facing location remains one indivisible execution-local reference
  mapped by the program to one canonical node. Retries reuse the frozen map.
- The existing V4 atomic-location builder is the sole mapping authority. The
  two-stage target consumes one already-authorized prepared input; Step A and
  Step B never rebuild location aliases or evidence scope independently.
- A deterministic location-scope fingerprint binds the canonical revision,
  ordered provider view and canonical resolver map. It is execution metadata,
  not cross-revision Finding identity.
- Occurrence continuity is based on checker contract, category, canonical
  primary node and normalized canonical related nodes.
- Root continuity is based on checker contract, category, affected argument
  roles and the set of occurrence fingerprints. Model wording is excluded.
- Existing anchor relocation remains responsible when canonical nodes change
  across revisions.
- Existing aggregate run status remains authoritative. Stage states are
  explanatory sub-statuses only.
- No severity field is accepted. Default display order remains canonical source
  order.
- The ArgumentMap provider adapter lives in the existing Grant model
  infrastructure boundary. Prompt and deterministic assembly remain in the
  diagnostics domain; no second gateway or provider authority is introduced.
- Argument mapping has one provider call in Step 3. Retry ownership is deferred
  to the future unified two-stage budget rather than embedded in this adapter.
- Root diagnosis owns semantic issue grouping: one root card may contain many
  canonical occurrences. Programs only deduplicate structurally identical
  fields, resolve references, enforce Evidence authorization and contain invalid
  related locations; they do not invent semantic merges.
- An invalid primary occurrence is unusable and removed. An invalid related
  location is removed without discarding an otherwise anchored root card. A
  finding with no valid occurrence or unauthorized Evidence Card is unusable.
- The two-stage provider budget is fixed at `ArgumentMap 1 + root diagnosis 2
  = total 3`. Only the aggregate executor owns retries.
- A root retry must change the failure condition: truncation raises the output
  cap, structured invalidity adds safe issue paths, and explicit 429/5xx errors
  use a transient retry. Unknown outcomes, 400s, reference failures and Evidence
  failures never retry automatically.
- A successful ArgumentMap is the only resumable checkpoint in this step.
  Recovery revalidates its source revision and frozen location scope before any
  provider call; an invalid checkpoint is rejected without spending budget.

## Consequences

The later implementation needs coordinated gateway, executor, assembler,
persistence and projection work, but it does not need a second route, button,
repository, model provider or recheck system. Historical findings remain
auditable. ArgumentMap variation cannot by itself create a new or resolved
Finding. Root cards can group multiple canonical occurrences without making the
model the owner of durable identity.

Step 6 confirms that root cards do not introduce a second Finding model.
`grant_findings` remains the envelope, additive V4 tables retain root-specific
content, and one normalized repository projection serves the UI. ArgumentMap
storage is a bounded recovery checkpoint, not an audit identity or UI model.

Step 7 confirms that rollout does not introduce a second route or checker
authority. The existing semantic checker selects one internal implementation.
Canary admission is stable by authenticated owner and requires explicit
database schema readiness. Rollback is server mode `off`; it restores the
existing V4 implementation without deleting historical records.
