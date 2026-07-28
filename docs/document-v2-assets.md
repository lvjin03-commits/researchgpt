# Document v2 Figure, Table, and Reference Assets

This document is authoritative for step 6 of the document-v2 migration.

## Figure responsibility chain

| Stage | Owner | Output |
|---|---|---|
| Need and meaning | component content model | structured `FigureRequestDraft` |
| System identity | orchestrator | stable `FigureRequest.requestId` |
| Final media creation | injected `FinalFigureGenerator` | PNG or SVG bytes |
| Technical acceptance | `ValidatedFigureAssetPipeline` | mature `FigureAsset` |
| Position and paragraph mapping | orchestrator | ordered figure block and asset references |
| Word placement | DOCX renderer | inline image, figure number, caption, alt text |

No stage after the figure generator may reinterpret the scientific meaning of
the image.

## Figure request

The content model may decide:

- figure type;
- title, mature caption, and alt text;
- semantic content brief for the image generator;
- placement after a specific local content block;
- paragraphs that cite the local figure request;
- verified evidence IDs supporting the figure.

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
- SHA-256 checksum over primary and fallback media.

The figure generator receives up to two local attempts by default. A
low-quality image retries the image generator only; it does not regenerate the
approved chapter text.

## Figure numbering and text references

Paragraph drafts reference local figure-request indexes, not hardcoded numbers.
After asset acceptance, the orchestrator maps those indexes to final asset IDs.
The renderer calculates figure numbers from final block order and emits the
visible reference, such as `[Fig. 1]` or `[图 1]`.

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

- production image-model or scientific-diagram provider;
- data-plot renderer driven by verified numeric datasets;
- native Word `REF` fields for cross-references;
- persistent asset storage and deduplication;
- figure-level UI progress and preview;
- production route integration.
