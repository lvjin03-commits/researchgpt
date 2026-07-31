import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DocumentRequestSchema,
  type DocumentRequest,
  type VerifiedReference,
} from "@/lib/document-v2/contracts";
import type { DocumentTemplateMatcher } from "@/lib/document-v2/templates/resolver";
import type { HierarchicalOutlinePlanner } from "@/lib/document-v2/planning/planner";
import {
  DocumentSkeletonDraftSchema,
  SectionPlanDraftSchema,
} from "@/lib/document-v2/planning/contracts";
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

export class ModelHierarchicalOutlinePlanner implements HierarchicalOutlinePlanner {
  constructor(private readonly executor: DocumentStructuredTextExecutor) {}

  async createSkeleton(input: Parameters<HierarchicalOutlinePlanner["createSkeleton"]>[0]) {
    return this.executor.generate({
      operation: "outline.skeleton",
      componentKey: "document-skeleton",
      maxOutputTokens: 3_000,
      schemaName: "document_skeleton_v1",
      schema: DocumentSkeletonDraftSchema.refine(
        (value) => value.sections.length >= input.minimumSections && value.sections.length <= input.maximumSections,
        "Section count is outside the template limits.",
      ),
      systemInstruction: [
        "Plan only the compact semantic skeleton of one SCI review document.",
        "Establish one evidence-informed review thesis and a clear scope boundary before planning sections.",
        "For each body section return only heading, question, concise purpose, and relative weight.",
        "Do not plan section details, evidence mappings, or write paragraphs yet.",
        "Plan body sections only. Title, abstract, keywords, conclusion, and references are fixed template components created separately.",
        "Use the requested language for headings.",
        "Stay within the supplied section limits.",
        "Plan at most four essential figures for the whole document. Each figure must belong to one body section and state its scientific purpose. Do not plan decorative or redundant figures.",
        "Never plan data_plot because no verified dataset is supplied at this stage.",
      ].join(" "),
      userInstruction: JSON.stringify({
        topic: input.request.userRequirements.topic,
        requirements: input.request.userRequirements.specialInstructions ?? [],
        minimumSections: input.minimumSections,
        maximumSections: input.maximumSections,
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
  }

  async planSection(input: Parameters<HierarchicalOutlinePlanner["planSection"]>[0]) {
    return this.executor.generate({
      operation: "outline.section_plan",
      componentKey: input.section.sectionId,
      maxOutputTokens: 1_800,
      schemaName: "document_section_plan_v1",
      schema: SectionPlanDraftSchema,
      validateCandidate: (candidate) => {
        const available = new Set(input.availableEvidenceIds);
        for (const id of candidate.requiredEvidenceIds) {
          if (!available.has(id)) throw new Error(`Unavailable evidence ID: ${id}`);
        }
      },
      systemInstruction: [
        "Plan the mature scientific argument for exactly one already-approved body section.",
        "Do not rename, split, reorder, or add sections and do not write prose paragraphs.",
        "State how this section advances the document thesis, its comparison dimensions, applicable conditions, failure modes, and evidence bindings.",
        "Use only IDs from availableEvidenceIds. Never invent evidence.",
      ].join(" "),
      userInstruction: JSON.stringify({
        topic: input.request.userRequirements.topic,
        reviewThesis: input.skeleton.reviewThesis,
        scopeBoundary: input.skeleton.scopeBoundary,
        section: input.section,
        neighboringSections: input.skeleton.sections.map(({ sectionId, heading, question }) => ({ sectionId, heading, question })),
        availableEvidenceIds: input.availableEvidenceIds,
      }),
    });
  }
}
