# ResearchGPT Architecture

This is the authoritative architecture record for the current project stage.
Update it only when a main workflow, core contract, or module responsibility changes.

## Status

| Item | State | Last verified commit |
|---|---|---|
| Current document workflow | Production legacy workflow | `97fbfdd` |
| Target document workflow | Approved, implementation starting | `97fbfdd` |
| Document v2 contracts | Initial contract baseline | Working tree |
| Direct v2 DOCX renderer | Implemented for text, tables, and verified references; not connected to production | Working tree |
| Document v2 orchestrator | Implemented and isolated; production adapters not connected | Working tree |
| Document v2 template system | SCI system template and user-template resolution framework implemented; no production parser connected | Working tree |
| Document v2 planner | Template-blueprint expansion and deterministic length allocation implemented; no production model connected | Working tree |
| Mature component generation | Structured model adapter and mature-content validator implemented; no production provider connected | Working tree |
| Figure, table, and reference assets | Mature figure pipeline, ordered placement, table blocks, and verified references implemented; no production image provider connected | Working tree |

## Current document workflow

The production chat route currently contains three document-output paths:

1. Export the previous assistant response directly.
2. Generate a dedicated artifact, including the structured DOCX path.
3. Generate a normal chat response and export that response afterward.

`POST /api/export` is a fourth independent export entry.

The detailed current workflow and line-level audit live under
`docs/code-audit/document-generation-mainline.md`.

## Target document workflow

```text
DocumentRequestBuilder
  -> TemplateResolver
  -> immutable ResolvedTemplateSnapshot
  -> DocumentPlanner
  -> ComponentGenerator
  -> DocumentValidator
  -> ordered FinalDocumentSpec.blocks
  -> DocxRenderer
  -> ExportService
```

The first migrated scenario is deliberately narrow:

- action: generate;
- format: DOCX;
- template: SCI review;
- language: Chinese or English;
- references only from verified user or literature-service sources;
- generated figures only through the validated asset materializer;
- no production uploaded-Word-template parser.

The initial renderer is `lib/document-v2/renderers/docx.ts`. It accepts only a
validated `FinalDocumentSpec`, applies the resolved template snapshot directly,
and never reads chat messages, Markdown, AI output, or legacy document models.
Figure blocks fail explicitly until a separate asset contract is implemented;
they cannot degrade into text placeholders.

The initial orchestrator is
`lib/document-v2/orchestration/orchestrator.ts`. It executes the immutable plan
in order, assigns stable program-owned block IDs, validates each component
before advancing, retries only the rejected component, and can resume from a
serialized paused state. It depends on injected generator and validator
interfaces; it does not import a model provider, chat route, renderer, storage,
or legacy document code.

The template system is under `lib/document-v2/templates/`. A user-uploaded
template always takes precedence over system matching. Without an upload, an
injected semantic matcher may select only from active registry candidates; its
result cannot create a new template identity. Both paths compile to the same
deep-frozen snapshot with a deterministic SHA-256 checksum.

The planner under `lib/document-v2/planning/` lets an injected semantic model
propose section meaning, names, order, evidence needs, and relative weights.
The program enforces template bounds, assigns component keys, allocates the
requested length, and builds the only accepted `DocumentPlan`.

The generation adapter under `lib/document-v2/generation/` requests exactly one
structured component at a time. It never asks for a complete manuscript.
Deterministic mature-content validation rejects internal fields, placeholders,
code fences, manual citation markers, duplicated abstract labels, and headings
that differ from the approved plan.

The asset pipeline under `lib/document-v2/assets/` separates semantic figure
requests from final media. The content model chooses purpose, type, caption,
evidence, paragraph linkage, and placement. An injected figure generator
returns final PNG or SVG bytes. The pipeline validates format, dimensions,
density, SVG safety, PNG fallback, and checksum before the orchestrator creates
an ordered figure block. The renderer receives only mature assets; generation
briefs never enter `FinalDocumentSpec`.

The runtime under `lib/document-v2/runtime/` owns the job lifecycle around the
orchestrator. It saves a validated checkpoint after each component, prevents
duplicate workers with a lease and optimistic revision, records bounded
structured events, supports cooperative cancellation and checkpoint resume,
and exposes a public snapshot that excludes document content and checkpoints.
Storage remains behind `DocumentJobRepository`; production persistence is not
implicitly coupled to the chat route. The Supabase adapter and owner-scoped
task API are guarded by `DOCUMENT_V2_RUNTIME_ENABLED`; applying its migration,
starting workers, and routing production traffic are separate rollout
decisions.

## Decision owners

| Decision | Authoritative owner | Downstream reinterpretation |
|---|---|---|
| Generate, export, or transform | `DocumentRequestBuilder` | Forbidden |
| Prompt, previous message, attachments, or existing document | `DocumentRequestBuilder` | Forbidden |
| Template identity and version | `TemplateResolver` | Forbidden |
| Components and their purposes | `DocumentPlanner` | Forbidden |
| Component content | `ComponentGenerator` | Cannot alter the plan |
| Component acceptance and local repair | `DocumentValidator` | May reject or request local repair |
| Final Word content and order | `FinalDocumentSpec` | Forbidden |
| Typography, pagination, and Word objects | `DocxRenderer` | Execution only |
| Storage and download URL | `ExportService` | Execution only |

## Core contracts

### DocumentRequest

Expresses the user's resolved action, authoritative source, language, output
format, template intent, and user requirements. `source.kind` is immutable after
the request is built.

### DocumentPlan

Contains one immutable template snapshot, program-owned component keys, and
evidence requirements. AI may propose semantic component content but cannot
create system IDs or replace the template snapshot.

### FinalDocumentSpec

The only input accepted by the future v2 renderer. Its ordered `blocks` define
headings, paragraphs, keywords, tables, and figures without renderer inference.

## Reference policy

- Formal references may come only from user-provided materials or a literature
  service that verified their metadata.
- Model memory is not a verified reference source.
- Unverified DOI, author, venue, or publication data must not enter the formal
  reference list.
- When no verified sources exist, the system may produce an explicitly marked
  draft without a reference list.

## Validation and repair policy

| Failure class | Handling |
|---|---|
| Structural | Deterministic repair or rejection |
| Local semantic | Regenerate only the failed component |
| Global quality | Replan or regenerate the document only when the whole plan is unusable |

Full-document rewriting is not the default recovery mechanism in document v2.

## Dependency boundaries

- `lib/document-v2/**` must not import production legacy document modules.
- A v2 renderer must not import chat routing, AI generation, or legacy modules.
- Legacy production paths may call existing legacy modules until their
  individual migration criteria are met.
- New document-generation capabilities must be implemented in document v2,
  not added to legacy paths.

## Migration policy

Legacy is frozen logically before any physical file move:

1. Register the legacy path in `TECH_DEBT.md`.
2. Prevent document v2 from importing it.
3. Implement and test one replacement scenario.
4. Enable the new scenario behind a temporary feature flag.
5. Make v2 the default for that scenario.
6. Confirm regression tests pass and legacy receives no traffic.
7. Obtain product authorization before deleting user-facing compatibility code.
8. Remove the feature flag after migration.
