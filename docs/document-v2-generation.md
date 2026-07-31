# Document v2 Planning and Mature Content Generation

This document is authoritative for step 5 of the document-v2 migration.

## Planning boundary

The semantic outline planner may decide:

- one review thesis and one explicit scope boundary;
- review questions that organize the document argument;
- section headings and order;
- the question each section answers and its contribution to the thesis;
- section purposes;
- comparison dimensions, applicable conditions, and failure modes;
- section count within template limits;
- relative section weights;
- required evidence from the provided evidence pool;
- the conclusion heading.
- essential non-quantitative figure purposes and their verified evidence
  bindings.

It cannot decide:

- template identity or version;
- fixed component keys;
- page or Word rendering rules;
- section count outside template bounds;
- evidence IDs outside the supplied pool;
- system IDs.
- a `data_plot` until a verified Dataset asset exists.

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

## Figure planning boundary

The Figure Plan is validated before content generation. Each released slot
freezes its section, allowed figure type, scientific purpose, and evidence IDs.
The component model may write the caption, accessibility text, and visual
content description, but it cannot change the figure type or evidence binding.

The current runtime has no verified Dataset asset layer. Therefore `data_plot`
is not an executable figure type and must be rejected during planning. The
outline planner receives one bounded repair opportunity to choose an allowed
non-quantitative type without changing the scientific purpose, or to omit the
figure. A Figure Plan error must never trigger a chapter rewrite.

## Component generation boundary

`ModelDocumentComponentGenerator` wraps an injected structured model. Each call
contains only one planned component plus:

- requested language and topic;
- the frozen review thesis, scope boundary, and review questions;
- planned type, heading, purpose, target length, and evidence IDs;
- the section question, thesis contribution, comparison dimensions,
  applicable conditions, and failure modes;
- approved earlier components;
- verified reference metadata;
- repair feedback from the previous local attempt.

The selected `ComponentContractDefinition` is the authoritative boundary for
each component type. It owns the model-output schema, contract version, legal
example, field ownership, and deterministic assembly into the existing
`GeneratedComponentPayload`.

The model returns semantic variables only:

- final prose and keyword text;
- verified citation IDs;
- planned figure-slot references;
- justified table and figure descriptions where the component contract allows
  them.

The model does not return `kind`, component or block IDs, revisions, planned
headings, heading levels, block discriminators, paragraph roles, figure types,
numbering, storage fields, or rendering metadata. The program injects those
values from the frozen plan and contract after model-output validation.

The generator receives only direct approved dependencies and evidence excerpts
explicitly authorized for the current component. It does not repeatedly inject
the entire approved document or the complete evidence pool.

The model must return mature content. It must not return:

- Markdown or code fences;
- reasoning or system prompts;
- `visualSpecs`, `evidenceType`, or `aistructure`;
- TODO, TBD, placeholders, or image prompts;
- manual citation labels such as `[1]`;
- handwritten figure or table numbers such as `Figure 1`, `[Fig. 2]`, or
  `图 3`;
- unverified reference metadata;
- a heading different from the approved plan.

## Validation order

```text
model semantic payload
-> component-specific model-output schema
-> deterministic contract assembly
-> orchestrator structural rules
-> mature-content deterministic rules
-> optional semantic reviewer
-> approved component
```

A rejection returns a machine-readable code and bounded repair feedback to the
same component. A component receives at most one repair attempt under the
current runtime budget. Earlier approved components remain unchanged.

## Implemented deterministic mature-content checks

| Check | Failure code |
|---|---|
| Internal fields, placeholders, TODO, prompts, or code fences | `internal_content_leak` |
| Manual numeric citation markers in prose | `manual_citation_marker` |
| Handwritten figure or table references in prose | `manual_cross_reference` |
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

## Remaining evidence and editorial work

- preliminary search-scope planning before evidence acquisition;
- automatic retrieval of verified literature from the selected library or
  authorized search;
- claim-tier metadata and evidence-informed delivery gating;
- compact component semantic summaries for document-wide consistency checks;
- optional editorial components such as standfirst, key points, and conclusion
  callouts.
