import { z } from "zod";
import { GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION } from "../ports/grant-diagnostic-model.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { grantNodeText } from "./node-text.ts";

const UuidSchema = z.string().uuid();
const LocationRefSchema = z.string().regex(/^N[1-9]\d*$/);
const SectionRefSchema = z.string().regex(/^S[1-9]\d*$/);

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

export const GrantDiagnosticAtomicNodeSchema = z.object({
  locationRef: LocationRefSchema,
  nodeType: z.enum(["heading", "paragraph", "list", "table", "figure", "citation", "formula"]),
  order: z.number().int().nonnegative(),
  text: z.string(),
}).strict();

export const GrantDiagnosticAtomicSectionSchema = z.object({
  sectionRef: SectionRefSchema,
  semanticRole: z.string().trim().min(1),
  title: z.string().trim().min(1),
  parentSectionRef: SectionRefSchema.nullable(),
  order: z.number().int().nonnegative(),
  nodes: z.array(GrantDiagnosticAtomicNodeSchema),
}).strict();

export const GrantSemanticDiagnosticV3ModelInputSchema = z.object({
  contractVersion: z.literal(GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION),
  documentLanguage: z.enum(["zh", "en"]),
  documentTitle: z.string().trim().min(1),
  fundingCategory: z.string().trim().min(1).max(200),
  inputMode: z.enum(["full_document", "section_bundle", "focused_excerpt"]),
  sections: z.array(GrantDiagnosticAtomicSectionSchema).min(1),
  evidenceCards: z.array(GrantSemanticDiagnosticV3EvidenceInputSchema).max(8),
  priorFindings: z.array(z.object({
    findingFingerprint: z.string().trim().min(1).max(128),
    category: z.string().trim().min(1).max(80),
    status: z.enum(["open", "closed", "superseded"]),
    locationRef: LocationRefSchema,
  }).strict()).max(100),
}).strict();

export type GrantSemanticDiagnosticV3EvidenceInput = z.infer<typeof GrantSemanticDiagnosticV3EvidenceInputSchema>;
export type GrantSemanticDiagnosticV3PriorFinding = z.infer<typeof GrantSemanticDiagnosticV3PriorFindingSchema>;
export type GrantSemanticDiagnosticV3ModelInput = z.infer<typeof GrantSemanticDiagnosticV3ModelInputSchema>;
export type GrantDiagnosticAtomicSection = z.infer<typeof GrantDiagnosticAtomicSectionSchema>;

export type GrantDiagnosticAtomicLocationScope = {
  sections: GrantDiagnosticAtomicSection[];
  locationByRef: ReadonlyMap<string, { sectionId: string; nodeId: string }>;
  locationRefByNodeId: ReadonlyMap<string, string>;
  sectionIdByNodeId: ReadonlyMap<string, string>;
};

export type GrantSemanticDiagnosticV3PreparedInput = {
  request: GrantSemanticDiagnosticV3ModelInput;
  locationByRef: ReadonlyMap<string, { sectionId: string; nodeId: string }>;
  locationRefByNodeId: ReadonlyMap<string, string>;
  sectionIdByNodeId: ReadonlyMap<string, string>;
  allowedEvidenceCardIds: ReadonlySet<string>;
};

export class GrantSemanticDiagnosticV3InputScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantSemanticDiagnosticV3InputScopeError";
  }
}

/**
 * The single authority for provider-facing grant location aliases. Every
 * semantic stage in one execution must reuse this prepared scope instead of
 * rebuilding or combining section/node identifiers independently.
 */
export function buildGrantDiagnosticAtomicLocationScope(input: {
  snapshot: CanonicalGrantSnapshot;
  inputSectionIds: string[];
  inputNodeIds: string[];
}): GrantDiagnosticAtomicLocationScope {
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

  const orderedSections = input.snapshot.sections
    .filter((section) => requestedSectionIds.has(section.sectionId))
    .sort((left, right) => left.order - right.order || left.sectionId.localeCompare(right.sectionId));
  const sectionRefById = new Map(orderedSections.map((section, index) => [section.sectionId, `S${index + 1}`]));
  const orderedNodes = orderedSections.flatMap((section) => input.snapshot.nodes
    .filter((node) => node.sectionId === section.sectionId && requestedNodeIds.has(node.nodeId))
    .sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId)));
  const locationRefByNodeId = new Map(orderedNodes.map((node, index) => [node.nodeId, `N${index + 1}`]));
  const locationByRef = new Map(orderedNodes.map((node) => [locationRefByNodeId.get(node.nodeId)!, {
    sectionId: node.sectionId,
    nodeId: node.nodeId,
  }]));

  const includedNodeIds = new Set(orderedNodes.map((node) => node.nodeId));
  if (includedNodeIds.size !== requestedNodeIds.size) {
    throw new GrantSemanticDiagnosticV3InputScopeError("Every requested node must belong to a requested section.");
  }

  return {
    sections: orderedSections.map((section) => ({
      sectionRef: sectionRefById.get(section.sectionId)!,
      semanticRole: section.semanticRole,
      title: section.title,
      parentSectionRef: section.parentSectionId ? sectionRefById.get(section.parentSectionId) ?? null : null,
      order: section.order,
      nodes: input.snapshot.nodes
        .filter((node) => node.sectionId === section.sectionId && requestedNodeIds.has(node.nodeId))
        .sort((left, right) => left.order - right.order)
        .map((node) => ({
          locationRef: locationRefByNodeId.get(node.nodeId)!,
          nodeType: node.nodeType,
          order: node.order,
          text: grantNodeText(node),
        })),
    })),
    locationByRef,
    locationRefByNodeId,
    sectionIdByNodeId: new Map([...locationByRef.values()].map((location) => [location.nodeId, location.sectionId])),
  };
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
  const locationScope = buildGrantDiagnosticAtomicLocationScope(input);
  const { sections, locationByRef, locationRefByNodeId, sectionIdByNodeId } = locationScope;
  const evidenceIds = input.evidenceCards.map((evidence) => evidence.cardId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new GrantSemanticDiagnosticV3InputScopeError("Evidence Card IDs must be unique.");
  }

  const queryText = [input.snapshot.title, ...sections.flatMap((section) => [section.title, ...section.nodes.map((node) => node.text)])].join("\n");
  const request = GrantSemanticDiagnosticV3ModelInputSchema.parse({
    contractVersion: GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION,
    documentLanguage: /[\u3400-\u9fff]/u.test(queryText) ? "zh" : "en",
    documentTitle: input.snapshot.title,
    fundingCategory: input.fundingCategory,
    inputMode: input.inputMode,
    sections,
    evidenceCards: input.evidenceCards,
    priorFindings: input.priorFindings.flatMap((finding) => {
      const locationRef = locationRefByNodeId.get(finding.nodeId);
      const location = locationRef ? locationByRef.get(locationRef) : undefined;
      if (!locationRef || location?.sectionId !== finding.sectionId) return [];
      return [{
        findingFingerprint: finding.findingFingerprint,
        category: finding.category,
        status: finding.status,
        locationRef,
      }];
    }),
  });

  return {
    request,
    locationByRef,
    locationRefByNodeId,
    sectionIdByNodeId,
    allowedEvidenceCardIds: new Set(evidenceIds),
  };
}
