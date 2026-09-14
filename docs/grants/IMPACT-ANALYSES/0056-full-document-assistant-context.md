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

Step 2 will add explicit capacity routing over this projection. Until that is
implemented and verified, existing assistant retrieval behavior remains active.
Rollback removes the unused projection and its tests; canonical data is unchanged.

