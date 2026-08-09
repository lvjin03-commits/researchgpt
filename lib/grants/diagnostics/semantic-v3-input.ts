import { z } from "zod";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { grantNodeText } from "./node-text.ts";

const UuidSchema = z.string().uuid();

export const GrantSemanticDiagnosticV3PriorFindingSchema = z.object({
  findingFingerprint: z.string().trim().min(1).max(128),
  category: z.string().trim().min(1).max(80),
  status: z.enum(["open", "closed", "superseded"]),
  sectionId: UuidSchema,
  nodeId: UuidSchema,
}).strict();

export const GrantSemanticDiagnosticV3EvidenceInputSchema = z.object({
  sourceId: UuidSchema,
  cardId: UuidSchema,
  sourceTitle: z.string().trim().min(1).max(500),
  provenanceType: z.enum(["published_literature", "own_unpublished_work", "project_material"]),
  verificationStatus: z.enum(["verified", "metadata_only"]),
  supportedScope: z.string().trim().min(1).max(1000),
  excerpt: z.string().trim().min(1).max(4000).nullable(),
  authorizationRevision: z.number().int().positive(),
  sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  excerptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict().superRefine((evidence, context) => {
  if (evidence.verificationStatus === "verified" && (!evidence.excerpt || !evidence.excerptHash)) {
    context.addIssue({
      code: "custom",
      path: ["excerpt"],
      message: "Verified evidence requires an excerpt and excerpt hash.",
    });
  }
  if (evidence.verificationStatus === "metadata_only") {
    if (evidence.excerpt !== null || evidence.excerptHash !== null) {
      context.addIssue({
        code: "custom",
        path: ["excerpt"],
        message: "Metadata-only evidence cannot expose excerpt content to the model.",
      });
    }
    if (evidence.supportedScope !== "record_existence_only") {
      context.addIssue({
        code: "custom",
        path: ["supportedScope"],
        message: "Metadata-only evidence can establish record existence only.",
      });
    }
  }
});

const DiagnosticNodeSchema = z.object({
  nodeId: UuidSchema,
  sectionId: UuidSchema,
  nodeType: z.enum(["heading", "paragraph", "list", "table", "figure", "citation", "formula"]),
  order: z.number().int().nonnegative(),
  text: z.string(),
}).strict();

const DiagnosticSectionSchema = z.object({
  sectionId: UuidSchema,
  semanticRole: z.string().trim().min(1),
  title: z.string().trim().min(1),
  parentSectionId: UuidSchema.nullable(),
  order: z.number().int().nonnegative(),
  nodes: z.array(DiagnosticNodeSchema),
}).strict();

export const GrantSemanticDiagnosticV3ModelInputSchema = z.object({
  contractVersion: z.literal("grant-semantic-review-v3"),
  documentLanguage: z.enum(["zh", "en"]),
  documentTitle: z.string().trim().min(1),
  fundingCategory: z.string().trim().min(1).max(200),
  inputMode: z.enum(["full_document", "section_bundle", "focused_excerpt"]),
  sections: z.array(DiagnosticSectionSchema).min(1),
  evidenceCards: z.array(GrantSemanticDiagnosticV3EvidenceInputSchema).max(8),
  priorFindings: z.array(GrantSemanticDiagnosticV3PriorFindingSchema).max(100),
}).strict();

export type GrantSemanticDiagnosticV3EvidenceInput = z.infer<typeof GrantSemanticDiagnosticV3EvidenceInputSchema>;
export type GrantSemanticDiagnosticV3PriorFinding = z.infer<typeof GrantSemanticDiagnosticV3PriorFindingSchema>;
export type GrantSemanticDiagnosticV3ModelInput = z.infer<typeof GrantSemanticDiagnosticV3ModelInputSchema>;

export type GrantSemanticDiagnosticV3PreparedInput = {
  request: GrantSemanticDiagnosticV3ModelInput;
  sectionIdByNodeId: ReadonlyMap<string, string>;
  allowedEvidenceCardIds: ReadonlySet<string>;
};

export class GrantSemanticDiagnosticV3InputScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantSemanticDiagnosticV3InputScopeError";
  }
}

export function buildGrantSemanticDiagnosticV3Input(input: {
  snapshot: CanonicalGrantSnapshot;
  inputMode: "full_document" | "section_bundle" | "focused_excerpt";
  inputSectionIds: string[];
  inputNodeIds: string[];
  fundingCategory: string;
  evidenceCards: GrantSemanticDiagnosticV3EvidenceInput[];
  priorFindings: GrantSemanticDiagnosticV3PriorFinding[];
}): GrantSemanticDiagnosticV3PreparedInput {
  const requestedSectionIds = new Set(input.inputSectionIds);
  const requestedNodeIds = new Set(input.inputNodeIds);
  if (requestedSectionIds.size !== input.inputSectionIds.length || requestedNodeIds.size !== input.inputNodeIds.length) {
    throw new GrantSemanticDiagnosticV3InputScopeError("Diagnostic input section and node IDs must be unique.");
  }

  const knownSectionIds = new Set(input.snapshot.sections.map((section) => section.sectionId));
  const knownNodeIds = new Set(input.snapshot.nodes.map((node) => node.nodeId));
  if (input.inputSectionIds.some((sectionId) => !knownSectionIds.has(sectionId))) {
    throw new GrantSemanticDiagnosticV3InputScopeError("Diagnostic input referenced a section outside the canonical snapshot.");
  }
  if (input.inputNodeIds.some((nodeId) => !knownNodeIds.has(nodeId))) {
    throw new GrantSemanticDiagnosticV3InputScopeError("Diagnostic input referenced a node outside the canonical snapshot.");
  }

  const sections = input.snapshot.sections
    .filter((section) => requestedSectionIds.has(section.sectionId))
    .sort((left, right) => left.order - right.order)
    .map((section) => ({
      sectionId: section.sectionId,
      semanticRole: section.semanticRole,
      title: section.title,
      parentSectionId: section.parentSectionId ?? null,
      order: section.order,
      nodes: input.snapshot.nodes
        .filter((node) => node.sectionId === section.sectionId && requestedNodeIds.has(node.nodeId))
        .sort((left, right) => left.order - right.order)
        .map((node) => ({
          nodeId: node.nodeId,
          sectionId: node.sectionId,
          nodeType: node.nodeType,
          order: node.order,
          text: grantNodeText(node),
        })),
    }));

  const includedNodeIds = new Set(sections.flatMap((section) => section.nodes.map((node) => node.nodeId)));
  if (includedNodeIds.size !== requestedNodeIds.size) {
    throw new GrantSemanticDiagnosticV3InputScopeError("Every requested node must belong to a requested section.");
  }
  const evidenceIds = input.evidenceCards.map((evidence) => evidence.cardId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new GrantSemanticDiagnosticV3InputScopeError("Evidence Card IDs must be unique.");
  }

  const queryText = [input.snapshot.title, ...sections.flatMap((section) => [section.title, ...section.nodes.map((node) => node.text)])].join("\n");
  const request = GrantSemanticDiagnosticV3ModelInputSchema.parse({
    contractVersion: "grant-semantic-review-v3",
    documentLanguage: /[\u3400-\u9fff]/u.test(queryText) ? "zh" : "en",
    documentTitle: input.snapshot.title,
    fundingCategory: input.fundingCategory,
    inputMode: input.inputMode,
    sections,
    evidenceCards: input.evidenceCards,
    priorFindings: input.priorFindings,
  });

  return {
    request,
    sectionIdByNodeId: new Map(sections.flatMap((section) => section.nodes.map((node) => [node.nodeId, node.sectionId]))),
    allowedEvidenceCardIds: new Set(evidenceIds),
  };
}
