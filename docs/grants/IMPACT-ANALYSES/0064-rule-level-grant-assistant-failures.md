# Impact analysis: Rule-level Grant Assistant failure attribution

## Change

The existing stage-aware Grant Assistant failure telemetry is extended with a
stable rule-level reason contract. A failure can therefore identify the exact
program rule that rejected execution, such as a missing planner target, an L2
anchor outside its section, or a required context larger than the configured
budget. This is an extension of the current Model Executor facts, not a second
logging or retry system.

Step 1 defines the contract and its privacy boundary. Step 2 adds nullable
columns and repository transport on the existing attempt row. Step 3 attaches
reasons at the detecting runtime boundaries and preserves post-provider
metadata through aggregation. Step 4 returns the safe diagnostic with the trace
ID, writes the same structured fields to platform logs, adds an owner-scoped
safe trace projection and attributes persistence-boundary failures. Production
migration 075 was applied after authorization; no paid provider was invoked.

## Authorities

- The component detecting a failed rule owns its stable reason code and safe
  numeric/boolean facts.
- The current pipeline owner supplies the factual execution stage.
- The reason registry owns the only valid mapping from reason code to component
  and broad failure category.
- Grant Model Executor remains the sole durable owner of attempt facts and trace
  identity.
- Grant Model Failure Presenter continues to own HTTP status, retryability and
  user-facing text. Reason codes cannot bypass or replace it.
- Operation Registry continues to own limits and retry policy.

## Data and Privacy

Rule-level facts are a strict allowlist of counts, limits, booleans and an HTTP
status number. Free-form strings, prompts, original grant text, diagnostics,
model output, provider response bodies, stack traces and source aliases are
rejected by the contract.

Provider request IDs, trace IDs, usage and context-manifest hashes remain their
existing top-level telemetry fields. They are not copied into rule facts.

## Affected Modules

- `lib/grants/model-execution/assistant-failure-reasons.ts` defines the new
  versioned contract and registry.
- Existing context planner, budget owner, planned-context assembler,
  hierarchical review, grounding validator and provider adapter will attach the
  contract in later steps.
- Migration 075 and the existing repositories carry optional reason data on the
  same `grant_model_calls` attempt. API presentation and UI expose only the
  stable diagnostic code, stage, component and allowlisted safe facts.

No canonical Grant document, Revision, diagnostic, evidence authorization,
Patch or export authority changes.

## Risks and Controls

- **Parallel authority:** prevented by storing rule facts only through the
  existing Model Executor path in later steps.
- **Category reinterpretation:** prevented by a tested immutable registry; a
  caller cannot pair a reason code with another category or component.
- **Misleading stage:** prevented by per-reason legal-stage validation.
- **Sensitive-content leakage:** prevented by a strict primitive-only facts
  schema and negative privacy tests.
- **Unbounded taxonomy:** reason codes describe stable program rules, not raw
  exception messages. Unknown exceptions use one explicit unclassified code.
- **False completion claim:** Step 1 is not visible in production and does not
  make historical traces retroactively precise.

## Rollout and Rollback

Step 4 exposes safe diagnostics and applied migration 075 after authorization.
The signed-in production path is verified after application deployment. Runtime
activation requires both the existing feature flag and schema marker 075.

Rollback before production removes the contract, migration, repository mapping,
tests and documentation. After migration application, nullable columns can stay
unused during a code rollback; no canonical Grant data is affected.
