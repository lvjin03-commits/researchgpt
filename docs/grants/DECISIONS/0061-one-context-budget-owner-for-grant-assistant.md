# ADR 0061: One context-budget owner for Grant Assistant turns

- Status: accepted, Step 1 implemented; production rollout pending
- Date: 2026-09-15
- Owners: Grant Assistant Operation Policy and Context Budget Planner
- Supersedes: per-function Grant Assistant planning and answer token checks

## Context

One visible Grant Assistant turn can build document memory, make a semantic
planning request and generate a grounded answer. The existing implementation
measured business payloads in several functions, while the provider adapter
added system instructions, source wrappers, structured-output contracts and
its own output limits. A later-stage failure could also discard request IDs and
usage already produced by earlier stages. Internal capacity failures therefore
appeared as provider outages and zero-token attempts.

## Decision

The registered `grant.assistant.chat` policy is the only owner of planning and
answer input/output limits. `GrantAssistantContextBudgetPlanner` is the only
owner of admitting optional conversation history. It measures the provider
messages produced by the same shared request builders used by the OpenAI
adapter, plus explicit conservative reserves for provider framing and the
structured-output schema.

Current user input and selected source context are required. Earlier
conversation is optional and may be omitted from newest to oldest only through
the budget planner. Every admission returns a non-sensitive manifest containing
policy/model/tokenizer identity, counts, omitted-message count and a payload
hash. Downstream model adapters receive the already-admitted request and the
policy-owned output limit; they do not reinterpret capacity.

Pipeline failures preserve aggregate usage and every known provider request ID
from completed earlier stages. Audit rows distinguish request dispatch from
known usage and record the failure stage. Missing usage remains unknown rather
than being interpreted as factual zero use.

## Alternatives Considered

- Raising the planner limit was rejected because it moves the same overflow to
  answer generation.
- Independent truncation in the planner, gateway and adapter was rejected
  because it creates competing authorities.
- Treating a visible turn as one opaque provider call was rejected because it
  loses factual cost and failure-stage information.

## Impact Analysis

- User-visible behavior: capacity failures are distinguished from provider
  outages; optional history can be reduced without dropping required grant
  context.
- Affected modules: operation policy, context admission, shared request
  builders, memory-planned pipeline, model executor, OpenAI adapter and model
  call telemetry.
- Data/schema impact: migration 073 adds stage and request/usage certainty
  metadata, request-ID lists and a context-manifest hash. It stores no content.
- Security/privacy impact: only hashes, counts and provider identifiers are
  added; no grant text or prompts are persisted.
- Compatibility and deletion condition: runtime activation requires schema
  marker 073. The old finish RPC signature is removed by migration 073.
- Rollback: revert the runtime and schema marker; new nullable telemetry columns
  can remain readable and inert.

## Verification

- Offline contract tests cover history adaptation, required-context rejection,
  policy-owned output limits and aggregate failure metadata.
- `npm run check:grant-architecture` and `npm run typecheck` must pass.
- Production migration, deployment and a paid provider call require separate
  authorization.
