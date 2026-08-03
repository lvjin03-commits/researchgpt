# STORM runtime admission — updated 2026-08-03

## Decision

**Dependency preparation passed; production activation remains blocked.**

This decision applies only to `services/storm-exploration`. Document V2 stays
on the verified runtime-off path and is not coupled to STORM availability.

## Admitted build candidate

| Item | Value |
| --- | --- |
| Upstream | `knowledge-storm==1.1.1` |
| Upstream wheel SHA-256 | `85e9ca115463bfe0731620d7b95b630b7509ba3b665e6e02d90b7fb7baef13d2` |
| Scoped derivative | `knowledge-storm==1.1.1+researchgpt.4` |
| Derivative wheel SHA-256 | `41864d4d63d7b710b2903b9980867561835edf683411dcd447de68024271bb6a` |
| Target | Python 3.11, Linux amd64 |
| Lock | `requirements-runtime.lock` |
| Lock SHA-256 | `79c6c7dcb2f3c6dfe36222682fc4a8a55aa329cd0781aa439326811e36374b45` |
| License inventory | `runtime-licenses.json` |

The derivative is built only from the exact upstream wheel. The builder fails
closed if the upstream hash or any expected patch target changes, writes
provenance into the wheel, rebuilds RECORD hashes, and emits reproducible bytes.

## Safety changes

- Removed the vulnerable mandatory DiskCache dependency and all persistent
  LiteLLM cache initialization.
- Forced DSPy cache use off before any upstream import and redirected DSPy's
  unavoidable import-time cache object to a service-private temporary path.
- Removed unused local sentence-transformer, Torch, Transformers, Qdrant and
  LangChain vector dependencies from the research-and-outline runtime.
- Changed Hugging Face tokenization and local semantic retrieval to explicit
  optional capabilities that fail with a clear error if invoked.
- Removed eager Co-STORM loading. Co-STORM is outside this runtime's scope.
- Kept article generation and article polishing disabled at the adapter boundary.

## Dependency and license review

The Python 3.11/Linux lock contains 102 packages and full hashes. A clean Python
3.11 environment installed the same versions and imported the scoped STORM
Runner API without DiskCache, Transformers, sentence-transformers, or Co-STORM.

The license inventory contains 104 installed distributions on the Windows
compatibility run, with zero unknown licenses. `tld` offers MPL-1.1 as one of
its alternatives; no proprietary or unknown license was found.

`pip-audit` reports 12 advisories for LiteLLM 1.80.0. Every reported advisory
affects LiteLLM Proxy HTTP/JWT/OIDC/MCP/admin routes. ResearchGPT never starts
or exposes LiteLLM Proxy; LiteLLM is used only as an outbound client library.
Newer LiteLLM releases require OpenAI SDK 2.x, which conflicts with upstream's
pinned DSPy 2.4.9 (`openai<2`). This is recorded as an accepted unreachable
advisory set, not represented as a claim that LiteLLM itself has no advisories.

## Remaining blockers

1. Build and run the final Linux image from the hash lock.
2. Run a credentialed, cost-capped DeepSeek-compatible + Tavily canary and
   persist provider request IDs alongside usage and cost.
3. Replace development SQLite or prove a single-worker persistent-volume
   deployment with restart and lease-recovery tests.
4. Run a cost-capped canary that can publish only a non-authoritative Proposal.

## Evidence verified

- Safe wheel builder unit tests and deterministic output.
- Full isolated service test suite.
- Clean Python 3.11 import of the actual derivative wheel and Runner API.
- DiskCache and local ML dependencies absent from the installed runtime.
- DSPy and LiteLLM disk caches disabled.
- Proposal conversion boundary tests.
- Runtime-off isolation plus real Document V2 DOCX generation.

Until the remaining blockers are cleared, `approved` stays false and
`STORM_RUNTIME_APPROVED` must remain false in production.
