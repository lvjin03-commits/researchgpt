# ADR 0036: Edit Session source controls reuse Evidence authority

## Decision

The conversation panel may upload a local file and search academic web metadata, but every selected source must become an Evidence Resource through the existing Evidence Service before it can enter a model turn. Search results alone never enter model context.

## Consequences

Local files are uploaded, explicitly authorized for model excerpts and reasoning, then selected. Web results require per-result confirmation and a fixed snapshot. The Grant Model Data Gateway continues to perform the current authorization check on every turn.
