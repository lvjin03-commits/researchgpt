# Document v2 Figure, Table, and Reference Assets

This document is authoritative for step 6 of the document-v2 migration.

## Figure responsibility chain

| Stage | Owner | Output |
|---|---|---|
| Need and meaning | frozen Figure Plan | typed slot, purpose, question, evidence mode, represented claims |
| System identity | orchestrator | stable `FigureRequest.requestId` |
| Final media creation | injected `FinalFigureGenerator` | PNG or SVG bytes |
| Technical acceptance | `ValidatedFigureAssetPipeline` | mature `FigureAsset` |
| Position and paragraph mapping | orchestrator | ordered figure block and asset references |
| Word placement | DOCX renderer | inline image, figure number, caption, alt text |

No stage after the figure generator may reinterpret the scientific meaning of
the image.

## Render and cost policy

Document V2 freezes one image execution profile per job. It does not reuse the
general chat image model setting.

| Strategy | Intended use | Provider call |
|---|---|---|
| `deterministic_svg` | flows, frameworks, comparisons, and node-arrow mechanisms | no |
| `verified_data_plot` | plots backed by verified structured numeric data | no |
| `generative_raster_standard` | morphology or spatial illustrations that cannot be represented deterministically | standard tier |
| `generative_raster_premium` | explicitly authorized premium illustrations | premium tier |

`textless_raster_overlay` remains readable only for checkpoints created before
the tiered policy and resolves to the standard tier. New requests do not emit
that value.

The default standard configuration is `gpt-image-1-mini`, medium quality, at
1536 x 1024. Premium defaults to `gpt-image-2`, high quality, but is disabled
unless the task freezes explicit authorization. Provider capability and rate
card versions are stored with the job instead of being re-resolved by each
worker.

The base raster is keyed by a canonical semantic fingerprint that excludes
figure numbers, captions, visible labels, file paths, and asset revisions.
Changing labels therefore re-renders the program-owned text layer without
paying to regenerate the visual base. The cache is scoped to the document
owner.

## Figure request

The Figure Plan freezes:

- figure type and evidence mode;
- the question answered and claims represented;
- verified evidence IDs.

The content model may decide:

- title, mature caption, and alt text;
- semantic content brief for the image generator;
- placement after a specific local content block;
- paragraphs that cite the local figure request;

The model does not supply final asset IDs, figure numbers, file names,
checksums, dimensions, or binary content.

`contentBrief` exists only between content generation and figure generation. It
is not copied into `FinalDocumentSpec` or the Word document.

## Figure quality gate

The validated pipeline enforces:

- actual PNG or SVG format;
- non-empty file no larger than 25 MB;
- bitmap dimensions of at least 900 x 400 pixels;
- declared density of at least 300 dpi;
- SVG without scripts, event handlers, `foreignObject`, or external HTTP
  resources;
- mandatory high-resolution PNG fallback for SVG;
- no fallback duplication for native PNG;
- aspect-ratio-preserving display size within the SCI page width;
- preferred display width, minimum readable width, label density, and layout
  preference;
- SHA-256 checksum over primary and fallback media.

The production worker performs at most one paid provider call for a base-asset
fingerprint. Provider output is stored before label overlay and final asset
upload. Conversion, label, upload, or DOCX failures resume from the stored base
asset and never regenerate approved chapter text.

## Figure numbering and text references

Paragraph drafts reference local figure-request indexes, not hardcoded numbers.
After asset acceptance, the orchestrator maps those indexes to final asset IDs.
The renderer calculates figure numbers from final block order and emits a
localized visible reference, such as `(see Fig. 1)` or `（见图 1）`.
Paragraph text containing handwritten figure or table numbers is rejected
before approval and again at the final document boundary.

This prevents references from drifting when a prior figure is inserted or
removed.

## Table contract

Tables are mature structured content, not screenshots or Markdown:

- final caption without a hardcoded table number;
- final column labels;
- rectangular rows with no missing cells;
- final display text in every cell;
- no internal evidence fields or placeholders.

The renderer assigns table numbering and applies the template-owned three-line
table style, header fill, alignment, widths, and repeating header.

## Reference contract

- Paragraphs carry verified reference IDs, not manual `[1]` text.
- Figure requests may cite only verified evidence IDs.
- Data plots require at least one verified evidence ID.
- The final reference-list component must include every reference cited by
  approved paragraphs.
- The renderer derives numeric citation and reference-list order from the
  verified final specification.
- Model memory cannot create formal reference metadata.

## Failure boundaries

| Failure | Scope |
|---|---|
| Invalid figure request or evidence | current content component |
| Low-resolution or malformed media | figure generator retry |
| Unsafe SVG | figure generator retry, then terminal asset failure |
| Missing PNG fallback | figure generator retry |
| Asset checksum mismatch during render | rendering stops; no placeholder |
| Malformed or empty table | current content component |
| Unknown citation ID | current content component |
| Reference list omits a used citation | reference-list component |

The pipeline never replaces a failed figure with its prompt, raw data, or a
text placeholder.

## Verified isolated scenario

The automated end-to-end scenario contains:

- mature title, abstract, keywords, sections, and conclusion;
- a verified citation and reference list;
- one editable three-line table;
- one SVG process diagram with a 300 dpi PNG fallback;
- one paragraph-to-figure reference;
- ordered table and figure captions in the DOCX.

The first generated bitmap is intentionally low resolution. Only the image
generator retries. The final DOCX is opened in Microsoft Word, exported, and
visually inspected.

## Not yet implemented

- data-plot renderer driven by verified numeric datasets;
- native Word `REF` fields for cross-references;
- figure-level UI progress and preview;
- task UI for premium image authorization.
