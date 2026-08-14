# Decision 0029 — One operation policy for Edit Session turns

## Status

Accepted for foundation implementation; no product traffic is enabled yet.

## Decision

Every future Edit Session generation turn uses the registered operation
`grant.edit_session.turn`. Its policy selects OpenAI, the configured Grant AI
model, at most two attempts, and the retryable failure categories. UI, routes,
session services, prompts and provider adapters may not reinterpret that
selection.

The operation uses the existing Grant AI model configuration so a deployment
has one model setting. This is not dynamic routing: the registry is the sole
owner that binds that configured model to this operation.

## Consequences

- The initial implementation does not split local and evidence-backed turns.
- A later split requires a new operation, impact analysis and decision record.
- Every attempt must enter the shared executor and model-call repository.
- Authorization remains per-call work of Grant Model Data Gateway and is not
  cached or inferred by the executor.

