import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import {
  DocumentRequestSchema,
  type DocumentRequest,
  type VerifiedReference,
} from "@/lib/document-v2/contracts";
import type { DocumentTemplateMatcher } from "@/lib/document-v2/templates/resolver";
import type { SemanticOutlinePlanner } from "@/lib/document-v2/planning/planner";
import { SemanticOutlineProposalSchema } from "@/lib/document-v2/planning/contracts";

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
  client: OpenAI,
  input: DocumentCreationInput,
): Promise<DocumentRequest> {
  const instruction = input.instruction.trim();
  if (!instruction || instruction.length > 8_000) {
    throw new Error("Document instruction must contain 1-8000 characters.");
  }
  const response = await client.responses.parse({
    model: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
    instructions: [
      "Understand the user's complete document request semantically.",
      "A continuation such as 'generate it' must be interpreted from the supplied instruction/context, never by keyword routing.",
      "Extract the actual scientific topic, requested output language, and content requirements.",
      "Set ready=false only when the scientific topic or document scope cannot be determined without changing the requested document.",
      "Do not ask about optional language, length, figures, authors, or formatting when safe defaults exist.",
      "Do not write document content yet.",
    ].join(" "),
    input: instruction,
    text: {
      format: zodTextFormat(UnderstoodRequestSchema, "document_request_v1"),
    },
  });
  if (!response.output_parsed) {
    throw new Error("The model could not understand the document request.");
  }
  const understood = response.output_parsed;
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
  constructor(private readonly client: OpenAI) {}

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
    const response = await this.client.responses.parse({
      model: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
      instructions:
        "Select exactly one compatible document template from the closed candidate list. Never invent a template.",
      input: JSON.stringify(input),
      text: { format: zodTextFormat(CandidateDecision, "template_match_v1") },
    });
    if (!response.output_parsed) throw new Error("No template decision returned.");
    return response.output_parsed;
  }
}

export class OpenAISemanticOutlinePlanner implements SemanticOutlinePlanner {
  constructor(private readonly client: OpenAI) {}

  async propose(input: Parameters<SemanticOutlinePlanner["propose"]>[0]) {
    const response = await this.client.responses.parse({
      model: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
      instructions: [
        "Plan the mature semantic structure of one SCI review document.",
        "Return only an outline; do not write paragraphs.",
        "Use the requested language for headings.",
        "Stay within the supplied section limits.",
        "Use only availableEvidenceIds; never invent evidence.",
        "Choose section order and relative weights from scientific logic.",
      ].join(" "),
      input: JSON.stringify({
        topic: input.request.userRequirements.topic,
        requirements: input.request.userRequirements.specialInstructions ?? [],
        minimumSections: input.minimumSections,
        maximumSections: input.maximumSections,
        availableEvidenceIds: input.availableEvidenceIds,
        templateComponents: input.template.componentBlueprints,
      }),
      text: {
        format: zodTextFormat(
          SemanticOutlineProposalSchema,
          "document_outline_v1",
        ),
      },
    });
    if (!response.output_parsed) throw new Error("No document outline returned.");
    return response.output_parsed;
  }
}
