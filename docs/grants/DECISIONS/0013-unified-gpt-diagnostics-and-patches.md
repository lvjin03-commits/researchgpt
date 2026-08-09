# ADR 0013: One GPT Configuration for Grant Diagnostics and Patches

- Status: Accepted
- Date: 2026-08-09

## Context

The Grant workspace exposes one diagnostic action, but the production checker registry previously contained only deterministic rules. AI Patch used a separately selected OpenAI-compatible provider and defaulted to DeepSeek. This made the visible action weaker than its intended meaning and allowed model identity to diverge across Grant capabilities.

## Decision

Grant AI uses one server-only configuration owner:

```text
provider = openai
model = GRANT_AI_MODEL or gpt-5.5
credential = OPENAI_API_KEY
```

The same OpenAI model adapter implements two explicit ports: semantic diagnosis and local Patch generation. Both enter through Grant Model Data Gateway. No Grant route, checker or UI component may instantiate a provider or choose another model.

The existing `AI诊断` action executes:

```text
deterministic checker registry
+ one bounded GPT semantic checker
-> existing Diagnostic Assembler
-> one Finding projection
```

The semantic checker owns only scientific-question, argument-chain, innovation, objective-method alignment, evidence-support and cross-section-consistency observations. It assigns no severity and cannot predict review outcomes. Program-issued section and node IDs are validated after model output.

If GPT fails, successful deterministic runs are retained and the UI explicitly marks semantic diagnosis incomplete. Failure is never represented as a complete AI diagnosis.

## Consequences

- Grant Patch no longer silently defaults to DeepSeek.
- Deterministic checks remain reproducible and independently auditable.
- Authorized local evidence may be supplied only through current authorization in the Model Data Gateway.
- Model changes invalidate semantic execution reuse through the checker configuration fingerprint.
- Production quality, cost and latency require effect-first verification after deployment.
