# ADR-0014: Grant diagnostic structured output and bounded recovery

## Status

Accepted, 2026-08-09.

## Context

The semantic Grant checker used JSON mode and then parsed the response with
Zod. A model response could therefore fail after a paid call without preserving
whether the cause was truncation, filtering, refusal, provider error, schema
drift, or an out-of-scope node reference. Repeating the same request manually
was not a reliable recovery policy.

## Decision

- Grant Model Data Gateway remains the single model-data authority.
- The OpenAI Grant adapter uses strict Structured Output for semantic
  diagnostics.
- One Grant-specific policy owns the maximum of two provider attempts.
- Truncation, filtering, refusal, schema failure, invalid references, rate
  limits, transient provider errors, and provider contract errors remain
  separate failure categories.
- Only truncation, schema/reference correction, rate limiting and transient
  provider failures are eligible for one controlled retry.
- Diagnostic run projections persist bounded, content-free execution metadata;
  raw application text and raw model output are not copied into logs.
- The checker, prompt, schema and execution policy versions are fingerprinted
  together. Cross-section diagnosis remains a category inside the same checker,
  not a parallel operation.

## Consequences

Historical runs remain readable. No database migration or new route is needed.
The user can distinguish an output-capacity failure from a schema or provider
failure. Strict output does not make truncation impossible, so token-limit
recovery remains an explicit branch.
