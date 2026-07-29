# Document v2 Planning and Mature Content Generation

This document is authoritative for step 5 of the document-v2 migration.

## Planning boundary

The semantic outline planner may decide:

- section headings and order;
- section purposes;
- section count within template limits;
- relative section weights;
- required evidence from the provided evidence pool;
- the conclusion heading.

It cannot decide:

- template identity or version;
- fixed component keys;
- page or Word rendering rules;
- section count outside template bounds;
- evidence IDs outside the supplied pool;
- system IDs.

The program preserves this final Word display order:

```text
title
-> abstract
-> keywords
-> section-01 ... section-N
-> conclusion
-> references
```

Display order is not generation order. The planner adds immutable component
dependencies so that body sections run first, followed by the conclusion,
abstract, keywords, final title, and reference selection. Abstract generation
therefore receives the approved body and conclusion; keywords receive the
approved abstract; the final title receives the completed semantic core.

The program allocates ten percent of the requested length to the abstract, ten
percent to the conclusion, and the remaining budget across sections according
to semantic relative weights. Component keys and exact target lengths are
deterministic.

## Component generation boundary

`ModelDocumentComponentGenerator` wraps an injected structured model. Each call
contains only one planned component plus:

- requested language and topic;
- planned type, heading, purpose, target length, and evidence IDs;
- approved earlier components;
- verified reference metadata;
- repair feedback from the previous local attempt.

The model returns one `GeneratedComponentPayload` without final block IDs.
The orchestrator assigns those IDs only after acceptance.

The generator receives only direct approved dependencies and evidence excerpts
explicitly authorized for the current component. It does not repeatedly inject
the entire approved document or the complete evidence pool.

The model must return mature content. It must not return:

- Markdown or code fences;
- reasoning or system prompts;
- `visualSpecs`, `evidenceType`, or `aistructure`;
- TODO, TBD, placeholders, or image prompts;
- manual citation labels such as `[1]`;
- unverified reference metadata;
- a heading different from the approved plan.

## Validation order

```text
model payload
-> payload schema
-> orchestrator structural rules
-> mature-content deterministic rules
-> optional semantic reviewer
-> approved component
```

A rejection returns a machine-readable code and repair feedback to the same
component. Earlier approved components remain unchanged.

## Implemented deterministic mature-content checks

| Check | Failure code |
|---|---|
| Internal fields, placeholders, TODO, prompts, or code fences | `internal_content_leak` |
| Manual numeric citation markers in prose | `manual_citation_marker` |
| Multiline or excessively long title | `title_not_final` |
| Abstract includes its own rendered label | `abstract_label_duplicated` |
| Section or conclusion heading differs from plan | `planned_heading_mismatch` |

Citation IDs and reference-pool membership are enforced by the orchestrator.

## Verified isolated flow

The automated scenario executes:

```text
DocumentRequest
-> SCI template resolution
-> semantic two-section outline
-> deterministic DocumentPlan
-> per-component structured generation
-> local repair of one contaminated section
-> FinalDocumentSpec
-> real DOCX
```

The contaminated section initially contains `TODO` and
`evidenceType=aistructure`. Only that section is regenerated. The resulting
DOCX is inspected structurally and rendered through Microsoft Word for page
review.

## Not yet implemented

- production model-provider binding;
- source-text retrieval and evidence packaging;
- token budgeting and context compaction;
- persistent jobs and progress streaming;
- production routing and feature flag.
