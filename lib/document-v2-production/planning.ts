import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DocumentRequestSchema,
  type DocumentRequest,
  type VerifiedReference,
} from "@/lib/document-v2/contracts";
import type { DocumentTemplateMatcher } from "@/lib/document-v2/templates/resolver";
import type { SemanticOutlinePlanner } from "@/lib/document-v2/planning/planner";
import { SemanticOutlineProposalSchema } from "@/lib/document-v2/planning/contracts";
import type { DocumentStructuredTextExecutor } from "./text-executor";

const UnderstoodRequestSchema = z
  .object({
    ready: z.boolean(),
    topic: z.string().trim().min(1).max(500).nullable(),
    language: z.enum(["zh", "en"]).nullable(),
    specialInstructions: z
      .array(z.string().trim().min(1).max(500))
      .max(20),
    question: z.string().trim().min(1).max(500).nullable(),
    reason: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export class DocumentClarificationNeededError extends Error {
  constructor(
    readonly question: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "DocumentClarificationNeededError";
  }
}

export type DocumentCreationInput = {
  idempotencyKey?: string;
  instruction: string;
  source?: DocumentRequest["source"];
  targetLength?: number;
  language?: "zh" | "en";
  verifiedReferences?: VerifiedReference[];
};

export async function understandDocumentRequest(
  executor: DocumentStructuredTextExecutor,
  input: DocumentCreationInput,
): Promise<DocumentRequest> {
  const instruction = input.instruction.trim();
  if (!instruction || instruction.length > 8_000) {
    throw new Error("Document instruction must contain 1-8000 characters.");
  }
  const understood = await executor.generate({
    operation: "request.understand",
    schemaName: "document_request_v1",
    schema: UnderstoodRequestSchema,
    systemInstruction: [
      "Understand the user's complete document request semantically.",
      "A continuation such as 'generate it' must be interpreted from the supplied instruction/context, never by keyword routing.",
      "Extract the actual scientific topic, requested output language, and content requirements.",
      "Set ready=false only when the scientific topic or document scope cannot be determined without changing the requested document.",
      "Do not ask about optional language, length, figures, authors, or formatting when safe defaults exist.",
      "Do not write document content yet.",
    ].join(" "),
    userInstruction: instruction,
  });
  if (!understood.ready) {
    if (!understood.question || !understood.reason) {
      throw new Error("The clarification response is incomplete.");
    }
    throw new DocumentClarificationNeededError(
      understood.question,
      understood.reason,
    );
  }
  if (!understood.topic || !understood.language) {
    throw new Error("The understood document request is incomplete.");
  }
  return DocumentRequestSchema.parse({
    requestId: input.idempotencyKey ?? randomUUID(),
    schemaVersion: 1,
    action: "generate",
    source: input.source ?? { kind: "prompt", sourceIds: [] },
    outputFormat: "docx",
    language: input.language ?? understood.language,
    templateIntent: "sci_review",
    userRequirements: {
      topic: understood.topic,
      targetLength: input.targetLength,
      specialInstructions: understood.specialInstructions,
    },
  });
}

export class OpenAITemplateMatcher implements DocumentTemplateMatcher {
  constructor(private readonly executor: DocumentStructuredTextExecutor) {}

  async match(input: Parameters<DocumentTemplateMatcher["match"]>[0]) {
    if (input.candidates.length === 1) {
      return {
        templateId: input.candidates[0].templateId,
        confidence: 1,
        rationale: "The only active compatible template was selected.",
      };
    }
    const CandidateDecision = z.object({
      templateId: z.string(),
      confidence: z.number().min(0).max(1),
      rationale: z.string().min(1).max(1000),
    }).strict();
    return this.executor.generate({
      operation: "template.match",
      schemaName: "template_match_v1",
      schema: CandidateDecision,
      systemInstruction:
        "Select exactly one compatible document template from the closed candidate list. Never invent a template.",
      userInstruction: JSON.stringify(input),
    });
  }
}

export class OpenAISemanticOutlinePlanner implements SemanticOutlinePlanner {
  constructor(private readonly executor: DocumentStructuredTextExecutor) {}

  async propose(input: Parameters<SemanticOutlinePlanner["propose"]>[0]) {
    const OutlineResponseSchema = z
      .object({
        sections: z
          .array(
            z
              .object({
                heading: z.string().trim().min(1).max(500),
                purpose: z.string().trim().min(1).max(1_000),
                relativeWeight: z.number().positive().max(100),
                requiredEvidenceIds: z.array(z.string().min(1).max(120)).max(500),
              })
              .strict(),
          )
          .min(input.minimumSections)
          .max(input.maximumSections),
        conclusionHeading: z.string().trim().min(1).max(500),
        figures: z
          .array(
            z
              .object({
                sectionIndex: z.number().int().min(0).max(99),
                figureType: z.enum([
                  "mechanism_diagram",
                  "process_flow",
                  "conceptual_framework",
                  "comparison_diagram",
                  "data_plot",
                ]),
                purpose: z.string().trim().min(1).max(1_000),
                requiredEvidenceIds: z
                  .array(z.string().min(1).max(120))
                  .max(500),
              })
              .strict(),
          )
          .max(4),
      })
      .strict();
    const response = await this.executor.generate({
      operation: "outline.plan",
      schemaName: "document_outline_v1",
      schema: OutlineResponseSchema,
      systemInstruction: [
        "Plan the mature semantic structure of one SCI review document.",
        "Return only an outline; do not write paragraphs.",
        "Plan body sections only. Title, abstract, keywords, conclusion, and references are fixed template components created separately.",
        "Never turn user instructions such as generating a title, abstract, keywords, figures, tables, or references into body sections.",
        "Each section purpose must be a concise scientific scope, not a production checklist, numbered figure/table specification, or list of many subsection directives.",
        "Split scientifically dense material across body sections while staying within the supplied limits.",
        "Use the requested language for headings.",
        "Stay within the supplied section limits.",
        "Use only availableEvidenceIds; never invent evidence.",
        "Choose section order and relative weights from scientific logic.",
        "Plan at most four essential figures for the whole document. Each figure must belong to one body section and state its scientific purpose. Do not plan decorative or redundant figures.",
        "The runtime currently has no verified dataset assets, so data_plot is unavailable. Never plan data_plot. Omit the figure when no allowed figure type preserves its scientific purpose.",
        "Bind each scientific figure only to relevant IDs from availableEvidenceIds through requiredEvidenceIds. Use an empty list only for a clearly conceptual, non-quantitative schematic.",
        input.repairFeedback
          ? `The previous outline was rejected. Correct all of these issues: ${input.repairFeedback}`
          : "",
      ].join(" "),
      userInstruction: JSON.stringify({
        topic: input.request.userRequirements.topic,
        requirements: input.request.userRequirements.specialInstructions ?? [],
        minimumSections: input.minimumSections,
        maximumSections: input.maximumSections,
        availableEvidenceIds: input.availableEvidenceIds,
        fixedComponentsHandledByTemplate: input.template.componentBlueprints
          .filter((component) => component.type !== "section")
          .map((component) => component.type),
        bodySectionContract: {
          minimumCount: input.minimumSections,
          maximumCount: input.maximumSections,
        },
        figureContract: {
          maximumCount: 4,
          plannedBeforeContentGeneration: true,
          verifiedDatasetIds: [],
          allowedFigureTypes: [
            "mechanism_diagram",
            "process_flow",
            "conceptual_framework",
            "comparison_diagram",
          ],
          dataPlotPolicy: "forbidden_without_verified_dataset",
        },
      }),
    });
    return SemanticOutlineProposalSchema.parse(response);
  }
}
