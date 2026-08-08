# ADR-0005: Cross-revision anchors use conservative relocalization

- Status: accepted
- Date: 2026-08-07
- Owners: ResearchGPT project owner
- Supersedes: none
- Superseded by: none

## Context

Eight drift scenarios were tested: unrelated insertion, unrelated deletion,
paragraph split, paragraph merge, section move, heading rename, paraphrase,
and table/type change. Exact text plus structural context safely auto-matched
insertion, deletion, and heading rename. The other five scenarios could not be
trusted for automatic relocation.

## Decision

An anchor may be automatically relocated only when the best candidate exceeds
a frozen confidence threshold and has a sufficient margin over the runner-up.
Split, merge, semantic move, paraphrase, and node-type changes default to
`human_review_required` or `unable_to_match`; they are never forced to the
nearest candidate.

## Consequences

- Stable node IDs remain authoritative inside one revision lineage.
- Cross-version Findings carry structural role, normalized text, and bounded
  surrounding context, but fuzzy scores do not create authority.
- PR3 must expose unlocated/ambiguous Findings instead of hiding them.

## Verification

- Eight fixed cases make the expected safe automatic-vs-human decision.
- `scripts/grant-spikes/run_spikes.py`
