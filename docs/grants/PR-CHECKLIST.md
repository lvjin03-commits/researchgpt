# Grant Platform Pull Request Checklist

Copy the relevant sections into every grant-platform PR.

## Scope and Ownership

- [ ] The user-visible or architectural outcome is stated.
- [ ] The authoritative owner for every changed decision is identified.
- [ ] The change does not introduce a second route, model, revision path,
      patch committer, authorization check, model gateway, or exporter.
- [ ] Cross-module changes include an impact analysis and ADR.
- [ ] Temporary compatibility has a removal condition and expiry.
- [ ] Any exception references an approved, non-expired Exception ID.

## Contracts First

- [ ] Input/output contracts and invariants changed before implementations.
- [ ] A failing regression/contract scenario exists for the old problem.
- [ ] Replaced code is removed, or its migration/deletion condition is recorded.
- [ ] Schema changes include a forward-compatible migration and rollback reader.

## Revision and Patch Safety

- [ ] Formal writes go only through Revision Service.
- [ ] Compare-and-swap rejects a stale base revision.
- [ ] Patch target/anchor IDs and hashes are validated programmatically.
- [ ] Actual patch impacts are recomputed rather than trusted from model output.
- [ ] User acceptance does not bypass scope, authorization, or concurrency checks.

## Evidence and Model Data

- [ ] Every model call enters through the Grant Model Data Gateway.
- [ ] Current authorization is queried at call time.
- [ ] Read, index, model-use, reasoning, and citation permissions stay separate.
- [ ] Provider admission matches data sensitivity.
- [ ] Revocation invalidates queued work, cached context, and dependent drafts.
- [ ] Untrusted document instructions cannot change system or patch authority.

## Diagnostics

- [ ] Findings identify checker/version/input hash and source locations.
- [ ] No unsupported severity or review-outcome prediction is introduced.
- [ ] User disposition is separate from lifecycle and recheck status.
- [ ] Checker conflicts are retained.
- [ ] Checker upgrades declare historical-Finding compatibility.
- [ ] Provider-facing strict schemas use required nullable fields and required
      arrays rather than optional properties.
- [ ] Semantic categories have boundary fixtures, including positive and
      negative examples for overlapping categories.
- [ ] Every returned section, node and Evidence Card ID was supplied and is
      currently authorized for its claimed scope.
- [ ] Finding fingerprints exclude recommendation phrasing and other unstable
      presentation text.
- [ ] Default issue order follows canonical source order and does not treat
      actionability or confidence as severity or priority.
- [ ] V2/V3 compatibility is normalized below the UI, and historical records
      remain auditable without becoming duplicate active Findings.

## Verification

- [ ] End-to-end and PostgreSQL tests obtain checker, contract, schema, prompt,
      and policy versions from production authorities; fixtures do not inject
      handwritten "correct" versions that bypass the production path.
- [ ] `npm run check:grant-architecture` passes.
- [ ] Typecheck/build and relevant automated tests pass.
- [ ] Existing chat, Document V2, upload, literature, and auth behavior was
      regression-tested when shared infrastructure changed.
- [ ] The actual user path and real output were verified per
      `docs/effect-first-development.md`.
- [ ] What was not verified is stated explicitly.

## Rollout

- [ ] Feature flags default to the intended safe state.
- [ ] Rollback keeps canonical content readable.
- [ ] Migration and deletion steps are documented.
- [ ] Logs and metrics do not expose sensitive application content.
