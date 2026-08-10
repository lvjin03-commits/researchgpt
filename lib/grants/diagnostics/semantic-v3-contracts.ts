import { z } from "zod";

export const GrantSemanticDiagnosticCategoryV3Schema = z.enum([
  "scientific_question_gap",
  "argument_chain_gap",
  "innovation_gap",
  "feasibility_support_gap",
  "objective_content_route_gap",
  "research_design_gap",
  "evidence_support_gap",
  "cross_section_inconsistency",
]);

export const GrantSemanticRelatedLocationRoleV3Schema = z.enum([
  "supporting_location",
  "conflicting_location",
  "upstream_dependency",
  "downstream_dependency",
  "comparison_location",
  "missing_expected_location",
]);

const ProviderAssessmentSchema = z.object({
  scope: z.enum(["cross_section", "section", "paragraph", "sentence", "term_or_citation"]),
  confidence: z.number(),
  actionability: z.enum(["directly_actionable", "requires_evidence", "requires_expert_judgment"]),
}).strict();

const ProviderLocationSchema = z.object({
  locationRef: z.string(),
}).strict();

const ProviderRelatedLocationSchema = z.object({
  locationRef: z.string(),
  role: GrantSemanticRelatedLocationRoleV3Schema,
  quote: z.string().nullable(),
}).strict();

/**
 * Provider-facing schema. Keep this inside the strict Structured Outputs
 * subset: no optional/defaulted properties and no format, pattern, length,
 * numeric-range or array-size constraints. Program validation happens below.
 */
export const GrantSemanticDiagnosticProviderResultV3Schema = z.object({
  findings: z.array(z.object({
    category: GrantSemanticDiagnosticCategoryV3Schema,
    title: z.string(),
    diagnosticFact: z.string(),
    reason: z.string(),
    recommendation: z.string(),
    possibleConsequence: z.string().nullable(),
    assessment: ProviderAssessmentSchema,
    primaryLocation: ProviderLocationSchema,
    relatedLocations: z.array(ProviderRelatedLocationSchema),
    usedEvidenceCardIds: z.array(z.string()),
  }).strict()),
}).strict();

const UuidSchema = z.string().uuid();
const BoundedTextSchema = z.string().trim().min(1).max(2400);

const ProgramLocationSchema = z.object({
  sectionId: UuidSchema,
  nodeId: UuidSchema,
}).strict();

export const GrantSemanticFindingContentV3Schema = z.object({
  category: GrantSemanticDiagnosticCategoryV3Schema,
  title: z.string().trim().min(1).max(240),
  diagnosticFact: BoundedTextSchema,
  reason: BoundedTextSchema,
  recommendation: BoundedTextSchema,
  possibleConsequence: z.string().trim().min(1).max(1600).nullable(),
  assessment: z.object({
    scope: z.enum(["cross_section", "section", "paragraph", "sentence", "term_or_citation"]),
    confidence: z.number().min(0).max(1),
    actionability: z.enum(["directly_actionable", "requires_evidence", "requires_expert_judgment"]),
  }).strict(),
  primaryLocation: ProgramLocationSchema,
  relatedLocations: z.array(z.object({
    sectionId: UuidSchema,
    nodeId: UuidSchema,
    role: GrantSemanticRelatedLocationRoleV3Schema,
    quote: z.string().trim().min(1).max(800).nullable(),
  }).strict()).max(12),
  usedEvidenceCardIds: z.array(UuidSchema).max(24),
}).strict().superRefine((finding, context) => {
  const seen = new Set<string>();
  for (const [index, location] of finding.relatedLocations.entries()) {
    const key = `${location.sectionId}:${location.nodeId}:${location.role}`;
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["relatedLocations", index],
        message: "Related locations must be unique by section, node and role.",
      });
    }
    seen.add(key);
  }
});

export const GrantSemanticDiagnosticResultV3Schema = z.object({
  findings: z.array(GrantSemanticFindingContentV3Schema).max(24),
}).strict();

export type GrantSemanticDiagnosticV3NormalizationAction = {
  path: string;
  rule:
    | "empty_quote_to_null"
    | "related_location_duplicate_removed"
    | "evidence_id_duplicate_removed"
    | "invalid_related_location_ref_removed"
    | "finding_invalid_primary_location_removed"
    | "finding_invalid_evidence_reference_removed"
    | "finding_required_related_location_missing_removed";
};

export function normalizeGrantSemanticDiagnosticV3ProviderResult(
  result: z.infer<typeof GrantSemanticDiagnosticProviderResultV3Schema>,
): { result: z.infer<typeof GrantSemanticDiagnosticProviderResultV3Schema>; actions: GrantSemanticDiagnosticV3NormalizationAction[] } {
  const actions: GrantSemanticDiagnosticV3NormalizationAction[] = [];
  return {
    result: {
      findings: result.findings.map((finding, findingIndex) => {
        const seenLocations = new Set<string>();
        const relatedLocations = finding.relatedLocations.flatMap((location, locationIndex) => {
          const key = `${location.locationRef}:${location.role}`;
          if (seenLocations.has(key)) {
            actions.push({ path: `findings.${findingIndex}.relatedLocations.${locationIndex}`, rule: "related_location_duplicate_removed" });
            return [];
          }
          seenLocations.add(key);
          if (location.quote !== null && location.quote.trim().length === 0) {
            actions.push({ path: `findings.${findingIndex}.relatedLocations.${locationIndex}.quote`, rule: "empty_quote_to_null" });
            return [{ ...location, quote: null }];
          }
          return [location];
        });
        const seenEvidence = new Set<string>();
        const usedEvidenceCardIds = finding.usedEvidenceCardIds.filter((cardId, evidenceIndex) => {
          if (seenEvidence.has(cardId)) {
            actions.push({ path: `findings.${findingIndex}.usedEvidenceCardIds.${evidenceIndex}`, rule: "evidence_id_duplicate_removed" });
            return false;
          }
          seenEvidence.add(cardId);
          return true;
        });
        return { ...finding, relatedLocations, usedEvidenceCardIds };
      }),
    },
    actions,
  };
}

export function resolveGrantSemanticDiagnosticV3LocationReferences(
  result: z.infer<typeof GrantSemanticDiagnosticProviderResultV3Schema>,
  scope: {
    locationByRef: ReadonlyMap<string, { sectionId: string; nodeId: string }>;
    allowedEvidenceCardIds: ReadonlySet<string>;
  },
): {
  result: GrantSemanticDiagnosticResultV3;
  actions: GrantSemanticDiagnosticV3NormalizationAction[];
  invalidPaths: string[];
} {
  const actions: GrantSemanticDiagnosticV3NormalizationAction[] = [];
  const invalidPaths: string[] = [];
  const findings = result.findings.flatMap((finding, findingIndex) => {
    const primaryLocation = scope.locationByRef.get(finding.primaryLocation.locationRef);
    if (!primaryLocation) {
      const path = `findings.${findingIndex}.primaryLocation.locationRef`;
      actions.push({ path, rule: "finding_invalid_primary_location_removed" });
      invalidPaths.push(path);
      return [];
    }

    const invalidEvidenceIndex = finding.usedEvidenceCardIds.findIndex((cardId) => !scope.allowedEvidenceCardIds.has(cardId));
    if (invalidEvidenceIndex >= 0) {
      const path = `findings.${findingIndex}.usedEvidenceCardIds.${invalidEvidenceIndex}`;
      actions.push({ path, rule: "finding_invalid_evidence_reference_removed" });
      invalidPaths.push(path);
      return [];
    }

    const relatedLocations = finding.relatedLocations.flatMap((location, locationIndex) => {
      const resolved = scope.locationByRef.get(location.locationRef);
      if (!resolved) {
        const path = `findings.${findingIndex}.relatedLocations.${locationIndex}.locationRef`;
        actions.push({ path, rule: "invalid_related_location_ref_removed" });
        invalidPaths.push(path);
        return [];
      }
      return [{ ...resolved, role: location.role, quote: location.quote }];
    });
    if (finding.category === "cross_section_inconsistency" && relatedLocations.length === 0) {
      const path = `findings.${findingIndex}.relatedLocations`;
      actions.push({ path, rule: "finding_required_related_location_missing_removed" });
      invalidPaths.push(path);
      return [];
    }
    return [{
      ...finding,
      primaryLocation,
      relatedLocations,
    }];
  });

  return {
    result: GrantSemanticDiagnosticResultV3Schema.parse({ findings }),
    actions,
    invalidPaths,
  };
}

export type GrantSemanticDiagnosticCategoryV3 = z.infer<typeof GrantSemanticDiagnosticCategoryV3Schema>;
export type GrantSemanticFindingContentV3 = z.infer<typeof GrantSemanticFindingContentV3Schema>;
export type GrantSemanticDiagnosticResultV3 = z.infer<typeof GrantSemanticDiagnosticResultV3Schema>;

export type GrantSemanticDiagnosticV3ReferenceScope = {
  sectionIdByNodeId: ReadonlyMap<string, string>;
  allowedEvidenceCardIds: ReadonlySet<string>;
};

export class GrantSemanticDiagnosticV3ReferenceError extends Error {
  readonly invalidPaths: string[];

  constructor(invalidPaths: string[]) {
    super("Semantic diagnostic V3 referenced a node or Evidence Card outside the supplied scope.");
    this.name = "GrantSemanticDiagnosticV3ReferenceError";
    this.invalidPaths = invalidPaths;
  }
}

export function assertGrantSemanticDiagnosticV3References(
  result: GrantSemanticDiagnosticResultV3,
  scope: GrantSemanticDiagnosticV3ReferenceScope,
): void {
  const invalidPaths: string[] = [];
  for (const [findingIndex, finding] of result.findings.entries()) {
    if (scope.sectionIdByNodeId.get(finding.primaryLocation.nodeId) !== finding.primaryLocation.sectionId) {
      invalidPaths.push(`findings.${findingIndex}.primaryLocation`);
    }
    for (const [locationIndex, location] of finding.relatedLocations.entries()) {
      if (scope.sectionIdByNodeId.get(location.nodeId) !== location.sectionId) {
        invalidPaths.push(`findings.${findingIndex}.relatedLocations.${locationIndex}`);
      }
    }
    for (const [evidenceIndex, cardId] of finding.usedEvidenceCardIds.entries()) {
      if (!scope.allowedEvidenceCardIds.has(cardId)) {
        invalidPaths.push(`findings.${findingIndex}.usedEvidenceCardIds.${evidenceIndex}`);
      }
    }
  }
  if (invalidPaths.length > 0) throw new GrantSemanticDiagnosticV3ReferenceError(invalidPaths);
}

type CategoryBoundary = {
  definition: string;
  positiveExamples: readonly string[];
  negativeExamples: readonly string[];
};

export const GRANT_SEMANTIC_V3_CATEGORY_BOUNDARIES = {
  scientific_question_gap: {
    definition: "The scientific question itself lacks a bounded object, relationship, hypothesis or testable criterion.",
    positiveExamples: ["The application names a research direction but does not state which variables or mechanism will be tested."],
    negativeExamples: ["The question is explicit, but the later experiment does not test it; classify the objective-to-route mismatch as objective_content_route_gap."],
  },
  argument_chain_gap: {
    definition: "A required inference is missing between background, knowledge gap, question, hypothesis or expected contribution.",
    positiveExamples: ["The background jumps from a general limitation directly to the proposed material without explaining why it addresses the gap."],
    negativeExamples: ["An explicit question lacks measurable variables; classify the question definition itself as scientific_question_gap."],
  },
  innovation_gap: {
    definition: "The stated innovation is not articulated or is not connected to the scientific contribution described by the application.",
    positiveExamples: ["The application claims an original mechanism, while the described work only combines existing methods and gives no new explanatory contribution."],
    negativeExamples: ["Whether the claimed innovation is globally novel cannot be decided without verified external evidence."],
  },
  feasibility_support_gap: {
    definition: "The applicant's own preparation, people, facilities, methods or schedule do not internally support the proposed work.",
    positiveExamples: ["A critical in-situ method appears in the route, but no available platform, prior method experience or access arrangement is described."],
    negativeExamples: ["A mechanism claim lacks literature or preliminary-result support; classify support for the claim as evidence_support_gap."],
  },
  objective_content_route_gap: {
    definition: "Objectives, research content and the technical route do not cover one another consistently.",
    positiveExamples: ["An objective promises causal mechanism identification, but the research content and route contain only performance screening."],
    negativeExamples: ["The route contains the required experiment but omits a necessary control; classify the design defect as research_design_gap."],
  },
  research_design_gap: {
    definition: "The stated study design lacks a control, validation, observable or failure-handling element needed by its own question.",
    positiveExamples: ["The application attributes an effect to an interface mechanism but provides only bulk performance tests and no direct or discriminating observation."],
    negativeExamples: ["The correct method is proposed but the applicant's access or experience is unsupported; classify that as feasibility_support_gap."],
  },
  evidence_support_gap: {
    definition: "A scientific assertion, mechanism, causal claim or novelty statement lacks support in the supplied application or authorized evidence.",
    positiveExamples: ["The text states that one ion dominates solvation without a cited result, preliminary observation or authorized Evidence Card supporting that assertion."],
    negativeExamples: ["The applicant has not shown access to the required instrument; classify applicant capability as feasibility_support_gap."],
  },
  cross_section_inconsistency: {
    definition: "Two or more sections conflict, drift in scope or fail to carry an upstream commitment into downstream content.",
    positiveExamples: ["The scientific question is limited to zinc, while the objective and expected outcomes silently expand the conclusion to multiple alkali metals."],
    negativeExamples: ["A gap occurs entirely inside one argument paragraph and does not depend on another section."],
  },
} as const satisfies Record<GrantSemanticDiagnosticCategoryV3, CategoryBoundary>;
