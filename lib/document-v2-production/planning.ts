import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DocumentRequestSchema,
  type DocumentRequest,
  type VerifiedReference,
} from "@/lib/document-v2/contracts";
import type { DocumentTemplateMatcher } from "@/lib/document-v2/templates/resolver";
import type { HierarchicalOutlinePlanner } from "@/lib/document-v2/planning/planner";
import type { DocumentStructuredTextExecutor } from "./text-executor";
import { createDocumentPlanningLanguageContract } from "@/lib/document-v2/planning/language-contract";
import {
  createFigureIntentsOperationContract,
  createRequestUnderstandOperationContract,
  createSectionIndexOperationContract,
  createSectionPlanOperationContract,
  createTemplateMatchOperationContract,
  createThesisOperationContract,
} from "./structured-operation-contracts";

function planningContext(input: {
  request: DocumentRequest;
  templateId: string;
  templateVersion: string;
  templateChecksum: string;
  planningRevision?: number;
}) {
  return Object.freeze({
    ...createDocumentPlanningLanguageContract(input.request.language),
    templateSnapshotId: `${input.templateId}@${input.templateVersion}`,
    templateChecksum: input.templateChecksum,
    requestRevision: input.planningRevision ?? 1,
  });
}

const UnderstoodRequestSchema = z
  .object({
    ready: z.boolean(),
    topic: z.string().trim().min(1).max(500).nullable(),
    language: z.enum(["zh", "en"]).nullable(),
    visualIntent: z.enum(["auto", "required", "forbidden"]),
    citationRequirement: z.enum(["required", "optional", "forbidden"]),
    referencePolicy: z.enum([
      "user_sources_only",
      "user_sources_plus_web",
      "web_search_only",
    ]),
    referenceSearchQuery: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .nullable()
      .default(null),
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
    ...createRequestUnderstandOperationContract({
      schema: UnderstoodRequestSchema,
    }),
    systemInstruction: [
      "Understand the user's complete document request semantically.",
      "A continuation such as 'generate it' must be interpreted from the supplied instruction/context, never by keyword routing.",
      "Extract the actual scientific topic, requested output language, and content requirements.",
      "Set visualIntent=forbidden when the user explicitly requests no images or figures, required when figures are explicitly required, otherwise auto.",
      "Set citationRequirement=required when references or citations are explicitly requested, forbidden when explicitly prohibited, otherwise optional.",
      "Set referencePolicy=user_sources_only only when the user explicitly restricts citations to supplied sources; use user_sources_plus_web when supplied sources may be supplemented; use web_search_only when citations are requested and no supplied literature is available.",
      "When references may be used, return a concise English scientific referenceSearchQuery that preserves the user's exact topic; otherwise return null. This is a retrieval query, not visible document content.",
      "Set ready=false only when the scientific topic or document scope cannot be determined without changing the requested document.",
      "Do not ask about optional language, length, figures, authors, or formatting when safe defaults exist.",
      "Do not write document content yet.",
    ].join(" "),
    userInstruction: JSON.stringify({
      instruction,
      hasUserReferences: (input.verifiedReferences?.length ?? 0) > 0,
    }),
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
      visualIntent: understood.visualIntent,
      citationRequirement: understood.citationRequirement,
      referencePolicy: understood.referencePolicy,
      referenceSearchQuery: understood.referenceSearchQuery ?? undefined,
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
      ...createTemplateMatchOperationContract({ schema: CandidateDecision }),
      systemInstruction:
        "Select exactly one compatible document template from the closed candidate list. Never invent a template.",
      userInstruction: JSON.stringify(input),
    });
  }
}

export class ModelHierarchicalOutlinePlanner implements HierarchicalOutlinePlanner {
  constructor(private readonly executor: DocumentStructuredTextExecutor) {}

  async createThesis(input: Parameters<HierarchicalOutlinePlanner["createThesis"]>[0]) {
    const context = planningContext({
      request: input.request,
      templateId: input.template.snapshot.templateId,
      templateVersion: input.template.snapshot.templateVersion,
      templateChecksum: input.template.snapshot.checksum,
      planningRevision: input.planningRevision,
    });
    return this.executor.generate({
      ...createThesisOperationContract(),
      systemInstruction: [
        "Define only the central thesis and scope of one SCI review document.",
        "Return one review thesis, one scope boundary, the principal review questions, and a conclusion heading.",
        "Do not plan sections, figures, evidence mappings, paragraphs, or internal IDs.",
        "Use the requested document language.",
      ].join(" "),
      userInstruction: JSON.stringify({
        planningContext: context,
        topic: input.request.userRequirements.topic,
        requirements: input.request.userRequirements.specialInstructions ?? [],
        fixedComponentsHandledByTemplate: input.template.componentBlueprints
          .filter((component) => component.type !== "section")
          .map((component) => component.type),
      }),
    });
  }

  async createSectionIndex(input: Parameters<HierarchicalOutlinePlanner["createSectionIndex"]>[0]) {
    const context = planningContext({
      request: input.request,
      templateId: input.template.snapshot.templateId,
      templateVersion: input.template.snapshot.templateVersion,
      templateChecksum: input.template.snapshot.checksum,
      planningRevision: input.planningRevision,
    });
    const repair = input.repair;
    const contract = createSectionIndexOperationContract({
      minimumSections: input.minimumSections,
      maximumSections: input.maximumSections,
    });
    return this.executor.generate({
      ...contract,
      systemInstruction: [
        repair
          ? "Repair only the language of the identified invalid headings in an existing body-section index."
          : "Plan only the compact body-section index for an already-approved SCI review thesis.",
        "For each body section return only heading, question, concise purpose, owned scope, excluded scope, and relative weight.",
        "Do not plan section details, evidence mappings, or write paragraphs yet.",
        "Plan body sections only. Title, abstract, keywords, conclusion, and references are fixed template components created separately.",
        context.documentLanguageInstruction,
        repair
          ? "Preserve section count, order, question, purpose, owned scope, excluded scope, and relative weight exactly. Do not change headings that were not identified as violations."
          : "Use the requested language for headings.",
        "Stay within the supplied section limits.",
        "Do not plan figures, tables, captions, prompts, evidence mappings, prose, or internal IDs.",
      ].join(" "),
      userInstruction: JSON.stringify({
        planningContext: context,
        mode: repair?.mode ?? "generate",
        sourceRevision: repair?.sourceRevision,
        sourceSectionIndex: repair?.sourceSectionIndex,
        violations: repair?.violations,
        topic: input.request.userRequirements.topic,
        thesis: input.thesis,
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
      }),
    });
  }

  async planFigureIntents(input: Parameters<HierarchicalOutlinePlanner["planFigureIntents"]>[0]) {
    const context = planningContext({
      request: input.request,
      templateId: input.template.snapshot.templateId,
      templateVersion: input.template.snapshot.templateVersion,
      templateChecksum: input.template.snapshot.checksum,
      planningRevision: input.planningRevision,
    });
    return this.executor.generate({
      ...createFigureIntentsOperationContract(),
      systemInstruction: [
        "Plan only essential scientific figure intents for the already-approved document structure.",
        "Return at most four figures and use the one-based sectionOrder supplied by the program.",
        "Do not rewrite, rename, split, or add sections and do not generate internal IDs.",
        "Do not plan decorative figures or data plots. When no figure materially improves scientific understanding, return an empty figures array.",
        "Set evidenceRequired=true only when the figure must represent supplied verified evidence rather than a conceptual relationship.",
        "Do not select, copy, invent, or return evidence IDs, reference IDs, or citation IDs. Concrete evidence binding belongs to section planning.",
        context.documentLanguageInstruction,
      ].join(" "),
      userInstruction: JSON.stringify({
        planningContext: context,
        topic: input.request.userRequirements.topic,
        visualIntent: input.request.userRequirements.visualIntent,
        sections: input.skeleton.sections.map((section) => ({
          sectionOrder: section.order + 1,
          heading: section.heading,
          question: section.question,
          purpose: section.purpose,
          owns: section.owns,
          excludes: section.excludes,
        })),
        evidenceContext: input.evidenceContext,
        maximumFigures: 4,
        allowedFigureTypes: [
          "mechanism_diagram",
          "process_flow",
          "conceptual_framework",
          "comparison_diagram",
        ],
      }),
    });
  }

  async planSection(input: Parameters<HierarchicalOutlinePlanner["planSection"]>[0]) {
    const context = planningContext({
      request: input.request,
      templateId: input.template.snapshot.templateId,
      templateVersion: input.template.snapshot.templateVersion,
      templateChecksum: input.template.snapshot.checksum,
      planningRevision: input.planningRevision,
    });
    return this.executor.generate({
      ...createSectionPlanOperationContract({
        componentKey: input.section.sectionId,
        availableEvidenceIds: input.availableEvidenceIds,
      }),
      systemInstruction: [
        "Plan the mature scientific argument for exactly one already-approved body section.",
        "Do not rename, split, reorder, or add sections and do not write prose paragraphs.",
        "State how this section advances the document thesis, its comparison dimensions, applicable conditions, failure modes, and evidence bindings.",
        "Use only IDs from availableEvidenceIds. Never invent evidence.",
        context.documentLanguageInstruction,
      ].join(" "),
      userInstruction: JSON.stringify({
        planningContext: context,
        topic: input.request.userRequirements.topic,
        reviewThesis: input.skeleton.reviewThesis,
        scopeBoundary: input.skeleton.scopeBoundary,
        section: input.section,
        neighboringSections: input.skeleton.sections.map(({ sectionId, heading, question }) => ({ sectionId, heading, question })),
        availableEvidenceIds: input.availableEvidenceIds,
        availableEvidence: (input.availableEvidence ?? []).map((item) => ({
          evidenceId: item.evidenceId,
          excerpt: item.excerpt.slice(0, 800),
        })),
      }),
    });
  }
}
