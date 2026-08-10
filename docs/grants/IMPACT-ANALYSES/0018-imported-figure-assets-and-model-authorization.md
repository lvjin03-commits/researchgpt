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

## Step 1 Scope

- Add strict Zod contracts for imported assets, anchors/captions and model use.
- Add default-deny permissions.
- Record the ownership and six-step delivery boundary in grant governance.
- Add a contract regression test and package script.

No importer, repository, migration, UI, model payload, diagnostic prompt,
feature flag or production composition changes in this step.

## Step 2 Scope

- Parse supported OOXML image relationships from the existing DOCX import path.
- Verify content hashes and upload each asset to an immutable, ASCII-only object
  path owned by the import storage adapter.
- Materialize canonical `figure` nodes in original reading order and record
  source/caption anchors without interpreting scientific meaning.
- Extend the single initial-document transaction to persist the immutable asset
  provenance with the initial Revision.
- Keep unsupported media and floating-layout loss visible as fidelity warnings.

Out of scope: workspace image rendering, image consent UI, model payloads,
multimodal diagnosis and any parallel import or document model.

## Compatibility and Risks

- Existing canonical snapshots remain valid because `FigureContentSchema` is
  not changed.
- Existing text-only diagnostics remain unchanged and images remain denied to
  models. Supported images replace the broad `image_not_imported` warning;
  unsupported or unbound assets retain precise warnings.
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
- `npm run test:grant-docx-import`

Migration 048 and a real PostgreSQL atomic-commit test remain pending explicit
authorization; no production-readiness claim is made before that effect test.
