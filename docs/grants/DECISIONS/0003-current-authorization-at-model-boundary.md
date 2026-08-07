# ADR-0003: Current evidence authorization is enforced at the model boundary

- Status: accepted
- Date: 2026-08-07
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

UI revocation is insufficient if cached contexts or queued model tasks retain
evidence. Sensitive and unpublished material requires a technical enforcement
point rather than a policy-only promise.

## Decision

Every grant model call passes through the Grant Model Data Gateway. The gateway
queries current evidence authorization and provider data policy at call time,
then builds a minimal allowlisted context. Cached authorization cannot permit a
call. Revocation invalidates queued work, context caches, and unaccepted patches.

## Consequences

- Read, index, model-use, reasoning, and citation permissions are independent.
- No checker or patch generator may instantiate a model client directly.
- Authorization revision and used evidence IDs are auditable without retaining
  unnecessary full sensitive prompts.

## Verification

- Authorization propagation spike before evidence-backed patching.
- Contract tests for revocation between queueing and provider dispatch.
- Architecture check forbidding direct model-provider imports outside the
  designated infrastructure boundary.
