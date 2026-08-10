# Impact Analysis 0018: Imported Figure Assets and Model Authorization

## Problem and Evidence

- Active DOCX import discards image payloads through Mammoth's image converter
  and records fidelity warnings.
- Canonical figure nodes can reference an asset but no imported asset lifecycle,
  source anchor or image-specific model authorization currently exists.
- Consequently the workspace and GPT diagnostic path cannot inspect figures,
  while adding image bytes directly to snapshots would inflate revision data and
  duplicate storage authority.

## Ownership

- DOCX Import Adapter owns deterministic extraction and OOXML source binding.
- Grant Figure Asset Repository owns durable asset identity, integrity and
  immutable storage metadata.
- Canonical Grant Document owns the figure node and reading order.
- Grant Figure Model Authorization Service owns per-revision image consent.
- Grant Model Data Gateway owns current-authorization and provider admission.
- The semantic checker may interpret an authorized figure, but cannot create or
  repair program identifiers, captions, ordering or storage data.

## Scope of This Change

- Add strict Zod contracts for imported assets, anchors/captions and model use.
- Add default-deny permissions.
- Record the ownership and six-step delivery boundary in grant governance.
- Add a contract regression test and package script.

No importer, repository, migration, UI, model payload, diagnostic prompt,
feature flag or production composition changes in this step.

## Compatibility and Risks

- Existing canonical snapshots remain valid because `FigureContentSchema` is
  not changed.
- Existing image warnings and text-only diagnostics remain unchanged.
- The new authorization is intentionally separate from Evidence authorization;
  both are enforced through the same Model Data Gateway rather than parallel
  provider paths.
- Later extraction must handle unsupported OOXML formats explicitly and must not
  claim page-layout fidelity from an embedded-image record alone.

## Rollback

Remove the unused contract module, test and governance entries. There is no data
or user-visible rollback.

## Verification

- `npm run test:grant-figure-assets`
- `npm run check:grant-architecture`
- `npm run typecheck`
- `npm run check:encoding`
