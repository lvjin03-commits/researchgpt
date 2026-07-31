import type {
  ComponentValidationResult,
  GeneratedComponentPayload,
} from "../orchestration/contracts";
import type {
  DocumentComponentValidator,
} from "../orchestration/orchestrator";

const INTERNAL_CONTENT_PATTERN =
  /visualSpecs|evidenceType|aistructure|figure placeholder|TODO|TBD|\{\{[^}]+\}\}|```|system prompt|tool call/i;
const MANUAL_CITATION_PATTERN = /\[(?:\d+)(?:\s*[-,]\s*\d+)*\]/;
const MANUAL_FIGURE_REFERENCE_PATTERN =
  /(?:\bfig(?:ure)?\.?\s*\d+\b|图\s*\d+|\[\s*(?:fig(?:ure)?\.?|图)\s*\d+\s*\])/i;
const MANUAL_TABLE_REFERENCE_PATTERN =
  /(?:\btable\s*\d+\b|表\s*\d+|\[\s*(?:table|表)\s*\d+\s*\])/i;

export interface SemanticComponentReviewer {
  review(input: {
    componentType:
      | "title"
      | "abstract"
      | "keywords"
      | "section"
      | "conclusion"
      | "reference_list";
    plannedHeading?: string;
    purpose: string;
    targetLength?: number;
    payload: GeneratedComponentPayload;
  }): Promise<ComponentValidationResult>;
}

function texts(payload: GeneratedComponentPayload): string[] {
  if (payload.kind === "title") return [payload.title];
  if (payload.kind === "references") return [];
  const blockTexts = payload.blocks.flatMap((block) => {
    if (block.type === "heading") return [block.text];
    if (block.type === "paragraph") return [block.text];
    if (block.type === "keywords") return block.values;
    return [
      block.caption,
      ...block.columns,
      ...block.rows.flatMap((row) => row),
    ];
  });
  return [
    ...blockTexts,
    ...payload.figureRequests.flatMap((request) => [
      request.title,
      request.caption,
      request.altText,
      request.contentBrief,
    ]),
  ];
}

function reject(code: string, feedback: string): ComponentValidationResult {
  return { accepted: false, code, feedback };
}

export class MatureDocumentComponentValidator
  implements DocumentComponentValidator
{
  constructor(
    private readonly semanticReviewer?: SemanticComponentReviewer,
  ) {}

  async validate(input: Parameters<DocumentComponentValidator["validate"]>[0]) {
    const contentTexts = texts(input.payload);
    if (contentTexts.some((text) => INTERNAL_CONTENT_PATTERN.test(text))) {
      return reject(
        "internal_content_leak",
        "Remove internal fields, prompts, placeholders, TODO text, and code fences.",
      );
    }
    if (contentTexts.some((text) => MANUAL_CITATION_PATTERN.test(text))) {
      return reject(
        "manual_citation_marker",
        "Remove manual numeric citation markers and use citationIds instead.",
      );
    }
    if (
      input.payload.kind === "blocks" &&
      input.payload.blocks.some(
        (block) =>
          block.type === "paragraph" &&
          (MANUAL_FIGURE_REFERENCE_PATTERN.test(block.text) ||
            MANUAL_TABLE_REFERENCE_PATTERN.test(block.text)),
      )
    ) {
      return reject(
        "manual_cross_reference",
        "Remove handwritten figure and table numbers. Use figureReferenceIds and structured relationships so the renderer owns final numbering.",
      );
    }
    if (
      input.payload.kind === "title" &&
      (input.payload.title.includes("\n") || input.payload.title.length > 240)
    ) {
      return reject(
        "title_not_final",
        "Return one concise final title without line breaks.",
      );
    }
    if (
      input.component.type === "abstract" &&
      input.payload.kind === "blocks" &&
      input.payload.blocks[0]?.type === "paragraph" &&
      /^(abstract|摘要)\s*[:：]?/i.test(input.payload.blocks[0].text)
    ) {
      return reject(
        "abstract_label_duplicated",
        "Return abstract content without an Abstract or 摘要 label; the renderer adds it.",
      );
    }
    if (
      (input.component.type === "section" ||
        input.component.type === "conclusion") &&
      input.payload.kind === "blocks"
    ) {
      const firstBlock = input.payload.blocks[0];
      if (
        firstBlock?.type !== "heading" ||
        firstBlock.text !== input.component.heading
      ) {
        return reject(
          "planned_heading_mismatch",
          `The first heading must exactly match "${input.component.heading}".`,
        );
      }
    }
    if (input.payload.kind === "blocks") {
      for (const block of input.payload.blocks) {
        if (
          block.type === "table" &&
          /^(table|表)\s*\d+/i.test(block.caption)
        ) {
          return reject(
            "table_caption_numbered",
            "Return a mature table caption without a table number; the renderer assigns numbering.",
          );
        }
        if (
          block.type === "table" &&
          block.rows.some((row) => row.some((cell) => !cell.trim()))
        ) {
          return reject(
            "table_cell_empty",
            "Every mature table cell must contain final display content.",
          );
        }
      }
      for (const request of input.payload.figureRequests) {
        if (/^(fig(?:ure)?\.?|图)\s*\d+/i.test(request.caption)) {
          return reject(
            "figure_caption_numbered",
            "Return a mature figure caption without a figure number; the renderer assigns numbering.",
          );
        }
      }
    }

    if (this.semanticReviewer) {
      return this.semanticReviewer.review({
        componentType: input.component.type,
        plannedHeading: input.component.heading,
        purpose: input.component.purpose,
        targetLength: input.component.targetLength,
        payload: input.payload,
      });
    }
    return { accepted: true } as const;
  }
}
