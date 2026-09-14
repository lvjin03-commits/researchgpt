# Impact analysis: full-document assistant context

## Problem

Grant Assistant currently retrieves at most six matching nodes. That path is
appropriate for narrow questions but cannot support a truthful whole-application
analysis because unselected sections never enter the model-data boundary.

## Step 1 scope

Introduce one deterministic, Revision-bound projection of the complete canonical
grant snapshot. It preserves canonical section hierarchy and node order, assigns
execution-local source aliases, formats every supported node type, and reports
coverage and a content hash. This step does not call a model, change routing,
persist a second document, or expose the projection to the browser.

## Step 2 scope

Add one deterministic capacity router over the Step 1 projection. It uses a
token-counter port with an `o200k_base` tiktoken adapter, and a versioned policy
that reserves output, protocol overhead and safety margin before choosing either
single-pass or hierarchical processing. Hierarchical routing groups whole
sections without dropping coverage and flags a section that still needs finer
subdivision. This step does not dispatch a model or replace the active six-node
assistant retrieval path.

## Step 3 scope

Add the hierarchical analysis executor and its model port. Oversized sections
are split at canonical node boundaries; a single oversized node is divided into
lossless Unicode fragments that retain its program-issued source alias. The
executor analyzes every unit, rejects model references outside that unit, then
synthesizes only after proving complete section and source coverage. If the
intermediate analyses exceed synthesis capacity, execution fails explicitly so
a later reduction stage can be authorized; no analysis is silently discarded.
The OpenAI adapter, unified Model Executor registration, billing, persistence and
assistant routing remain Step 4 integration work.

## Step 4 scope

Connect explicit whole-application questions to the complete-context authority
through `GrantAssistantChatService` and `GrantModelDataGateway`. A deterministic
intent boundary selects whole-document context only for unscoped, non-web chat;
explicit selections, Candidates, Evidence and web search keep their existing
owners. Single-pass analysis sends every canonical node plus the complete section
outline. Hierarchical analysis uses the Step 3 executor and the OpenAI adapter's
structured unit/synthesis contracts. The existing `grant.assistant.chat`
Operation, retry ceiling, model-call repository and usage observer remain the
sole execution and billing path; no parallel route or Operation is introduced.

## Ownership and invariants

- The Grant Document Repository and Revision Service remain authoritative for
  content and version.
- Grant Model Data Gateway remains the only future authority allowed to admit
  this projection to a provider.
- Canonical UUIDs remain program-only; provider-facing text uses local aliases.
- Every canonical section and node is represented exactly once. Missing or
  duplicate coverage fails construction instead of silently truncating.
- Figures contribute only existing alt text and captions. Image bytes remain
  under the existing figure-authorization boundary.

## Follow-up and rollback

Step 5 will extend complete-document grounding to web-assisted turns and expose
coverage metadata in the UI before production effect verification. Narrow chat
continues using retrieval. Rollback removes
the unused projection, capacity router, tokenizer dependency and their tests;
canonical data is unchanged.

