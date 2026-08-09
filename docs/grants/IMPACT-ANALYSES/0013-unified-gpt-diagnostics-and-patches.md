# Impact Analysis 0013: Unified GPT Diagnostics and Patches

## Problem and Evidence

- Observed behavior: the user-facing grant check button runs only four deterministic rules, while AI Patch independently defaults to a DeepSeek-compatible provider.
- Root cause: diagnostics and patching do not share one Grant AI configuration owner, and no semantic checker is connected to the existing diagnostic execution contract.
- Why this is not only a symptom: changing a button label or adding another route would preserve the split authority and could silently produce partial diagnostics.

## Ownership

- Current authoritative owners: deterministic Finding conclusions belong to their checkers; model context belongs to Grant Model Data Gateway; patch scope belongs to Patch Policy.
- Owner after the change: these owners remain unchanged. A new semantic checker owns only its six declared semantic diagnostic categories. `resolveGrantAiConfig` is the single provider/model configuration owner.
- Downstream consumers: Diagnostic Service, Grant workspace issue panel, Patch Service.
- Decisions downstream modules must not reinterpret: provider/model identity, evidence authorization, node identity, Finding severity, patch scope and canonical writes.

## Scope

- Expected changes: Grant AI ports/adapter/configuration, Model Data Gateway, semantic checker composition, diagnostic coverage projection, issue-panel status, contracts and tests.
- User-visible change: one `AI诊断` action runs deterministic checks and GPT semantic diagnosis; local Patch proposals use the same GPT model.
- Must remain unchanged: canonical revision writes, explicit user Patch acceptance, deterministic checker conclusions, Document V2, chat, imports and exports.
- Data/schema impact: none. Existing diagnostic run JSON records provider/model/usage metadata.
- Security/privacy impact: application and authorized evidence excerpts continue to enter models only through Grant Model Data Gateway; highly sensitive evidence remains excluded.

## Options

- Chosen: one OpenAI GPT model adapter implementing diagnostic and patch ports, composed through one model-data gateway factory.
- Rejected: a second AI-diagnostic route, direct provider calls from a checker, silent DeepSeek fallback, or replacing deterministic checks with a model.
- No parallel authority: the existing diagnostic execution, Finding assembler and Patch Service are reused.
- Removed path: the DeepSeek/OpenAI-compatible Grant Patch adapter and Grant-only provider/model fallback variables.

## Migration and Rollback

- Compatibility period: none; Grant AI is explicitly OpenAI-only after this change.
- Feature flags: existing Grant workspace and Patch flags remain authoritative.
- Rollback: revert the code revision. Canonical documents, revisions, Findings and proposals remain readable.
- Data readability: unchanged because no migration is introduced.

## Verification

- Contract tests: semantic finding anchoring, provider metadata, invalid-ID rejection and partial-failure disclosure.
- Architecture check: `npm run check:grant-architecture`.
- Regression: deterministic diagnostics, AI Patch and evidence-backed Patch suites.
- Real user-path check: requires a deployed signed-in `AI诊断` run with a configured OpenAI key.
- Not yet verifiable before deployment: production latency, cost and real model quality.
