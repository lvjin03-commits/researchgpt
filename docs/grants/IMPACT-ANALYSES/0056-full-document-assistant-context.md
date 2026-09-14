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

Step 3 will execute hierarchical analysis and define subdivision for oversized
sections. Until that is implemented and later connected through the Model Data
Gateway, existing assistant retrieval behavior remains active. Rollback removes
the unused projection, capacity router, tokenizer dependency and their tests;
canonical data is unchanged.

