import { z } from "zod";
import {
  GrantFactMapCoverageDispositionV1Schema,
  GrantScientificEvidenceTierV1Schema,
} from "../diagnostics/semantic-review-v6-contracts.ts";
import type { GrantResearchSourceAssessmentView } from "./research-source-assessment.ts";
import {
  decideGrantResearchSuggestionScope,
  GrantResearchScopeSignalsSchema,
  type GrantResearchScopeDecision,
} from "./research-scope-decision.ts";

const BoundedTextSchema = z.string().trim().min(1).max(2000);

export const GrantResearchGapComparisonProviderV1Schema = z.object({
  schemaVersion: z.literal(1),
  comparisons: z.array(z.object({
    sourceGroupId: z.string().uuid(),
    existingDesignStatus: z.enum(["found", "not_found", "unable_to_verify"]),
    existingDesign: z.array(z.object({
      locationRef: z.string().trim().min(1).max(100),
      summary: z.string().trim().min(1).max(1200),
      evidenceTier: GrantScientificEvidenceTierV1Schema,
      coverageLevel: z.enum(["mentioned", "planned", "preliminary_result", "completed_result"]),
      verificationStatus: z.enum(["document_statement_only", "data_or_figure_present", "published_source_linked", "independently_verified", "unable_to_verify"]),
      supportBoundary: z.object({
        directlySupports: z.array(BoundedTextSchema).max(10),
        indirectlySupports: z.array(BoundedTextSchema).max(10),
        doesNotSupport: z.array(BoundedTextSchema).max(10),
      }).strict(),
    }).strict()).max(6),
    disposition: GrantFactMapCoverageDispositionV1Schema,
    residualGap: BoundedTextSchema.nullable(),
    reasonExistingDesignIsInsufficient: BoundedTextSchema.nullable(),
    recommendation: BoundedTextSchema.nullable(),
    unableToVerifyReason: z.enum([
      "insufficient_application_context",
      "ambiguous_application_mapping",
      "source_evidence_insufficient",
    ]).nullable(),
    scopeSignals: GrantResearchScopeSignalsSchema,
  }).strict()).max(25),
}).strict();

export type GrantResearchGapComparison = {
  sourceGroupId: string;
  existingDesignStatus: "found" | "not_found" | "unable_to_verify";
  existingDesign: Array<{
    sectionId: string;
    nodeId: string;
    summary: string;
    evidenceTier: z.infer<typeof GrantScientificEvidenceTierV1Schema>;
    coverageLevel: "mentioned" | "planned" | "preliminary_result" | "completed_result";
    verificationStatus: "document_statement_only" | "data_or_figure_present" | "published_source_linked" | "independently_verified" | "unable_to_verify";
    supportBoundary: { directlySupports: string[]; indirectlySupports: string[]; doesNotSupport: string[] };
  }>;
  latestDevelopment: Pick<GrantResearchSourceAssessmentView,
    "mechanismSummary" | "quantitativeFindings" | "applicationRelation" | "evidenceLimitations"
    | "publicationYear" | "doi" | "primarySourceId">;
  disposition: z.infer<typeof GrantFactMapCoverageDispositionV1Schema>;
  residualGap: string | null;
  reasonExistingDesignIsInsufficient: string | null;
  recommendation: string | null;
  unableToVerifyReason: "insufficient_application_context" | "ambiguous_application_mapping"
    | "source_evidence_insufficient" | null;
  scopeDecision: GrantResearchScopeDecision;
  rejectedSuggestion: {
    candidateSummary: string;
    relatedSourceIds: string[];
    rejectionReason: "already_covered" | "adjacent_topic" | "major_scope_expansion";
  } | null;
};

export function assembleGrantResearchGapComparisons(input: {
  providerResult: unknown;
  assessments: readonly GrantResearchSourceAssessmentView[];
  locationByRef: ReadonlyMap<string, { sectionId: string; nodeId: string }>;
}): GrantResearchGapComparison[] {
  const provider = GrantResearchGapComparisonProviderV1Schema.parse(input.providerResult);
  const recommended = new Map(input.assessments.filter((assessment) => assessment.disposition === "recommended")
    .map((assessment) => [assessment.sourceGroupId, assessment]));
  if (recommended.size !== input.assessments.filter((assessment) => assessment.disposition === "recommended").length) {
    throw new Error("Recommended research-source assessment IDs must be unique.");
  }
  const comparisonIds = provider.comparisons.map((comparison) => comparison.sourceGroupId);
  if (new Set(comparisonIds).size !== comparisonIds.length) throw new Error("A research source group may be compared only once.");
  if (comparisonIds.length !== recommended.size || comparisonIds.some((id) => !recommended.has(id))) {
    throw new Error("Every recommended research source group must be compared exactly once.");
  }

  return provider.comparisons.map((comparison) => {
    if (comparison.existingDesignStatus === "found" && comparison.existingDesign.length === 0) {
      throw new Error("A found existing design requires at least one application location.");
    }
    if (comparison.existingDesignStatus !== "found" && comparison.existingDesign.length > 0) {
      throw new Error("Only a found existing design may declare application locations.");
    }
    if ((comparison.disposition === "unable_to_verify") !== (comparison.existingDesignStatus === "unable_to_verify")) {
      throw new Error("Unable-to-verify disposition and existing-design status must agree.");
    }
    if (comparison.disposition === "residual_gap_found") {
      if (!comparison.residualGap || !comparison.reasonExistingDesignIsInsufficient || !comparison.recommendation
        || comparison.unableToVerifyReason) {
        throw new Error("A residual gap requires its gap, insufficiency reason and recommendation only.");
      }
    } else if (comparison.disposition === "verified_no_residual_gap") {
      if (comparison.residualGap || comparison.reasonExistingDesignIsInsufficient || comparison.recommendation
        || comparison.unableToVerifyReason) {
        throw new Error("Verified no-gap comparisons cannot publish a residual gap or recommendation.");
      }
    } else if (comparison.residualGap || comparison.reasonExistingDesignIsInsufficient || comparison.recommendation
      || !comparison.unableToVerifyReason) {
      throw new Error("Unable-to-verify comparisons require only a verification reason.");
    }

    const seenLocations = new Set<string>();
    const existingDesign = comparison.existingDesign.map((design) => {
      const location = input.locationByRef.get(design.locationRef);
      if (!location) throw new Error("Existing design references a location outside the frozen application context.");
      const key = `${location.sectionId}:${location.nodeId}`;
      if (seenLocations.has(key)) throw new Error("Existing-design locations must be unique.");
      seenLocations.add(key);
      return { ...location, summary: design.summary, evidenceTier: design.evidenceTier,
        coverageLevel: design.coverageLevel, verificationStatus: design.verificationStatus,
        supportBoundary: design.supportBoundary };
    });
    const assessment = recommended.get(comparison.sourceGroupId)!;
    const calculatedScope = decideGrantResearchSuggestionScope(comparison.scopeSignals);
    const scopeDecision: GrantResearchScopeDecision = comparison.disposition === "verified_no_residual_gap"
      ? { finalDecision: "reject", relevance: calculatedScope.relevance,
        scopeImpact: calculatedScope.scopeImpact, rejectionReason: null }
      : comparison.disposition === "unable_to_verify"
        ? { finalDecision: "reject", relevance: calculatedScope.relevance,
          scopeImpact: calculatedScope.scopeImpact, rejectionReason: null }
        : calculatedScope;
    const rejectionReason = comparison.disposition === "verified_no_residual_gap" ? "already_covered" as const
      : scopeDecision.rejectionReason;
    const rejectedSuggestion = scopeDecision.finalDecision === "reject" && rejectionReason
      ? { candidateSummary: comparison.recommendation ?? assessment.applicationRelation
          ?? assessment.mechanismSummary ?? comparison.sourceGroupId,
        relatedSourceIds: [assessment.primarySourceId], rejectionReason }
      : null;
    return {
      sourceGroupId: comparison.sourceGroupId,
      existingDesignStatus: comparison.existingDesignStatus,
      existingDesign,
      latestDevelopment: {
        mechanismSummary: assessment.mechanismSummary,
        quantitativeFindings: assessment.quantitativeFindings,
        applicationRelation: assessment.applicationRelation,
        evidenceLimitations: assessment.evidenceLimitations,
        publicationYear: assessment.publicationYear,
        doi: assessment.doi,
        primarySourceId: assessment.primarySourceId,
      },
      disposition: comparison.disposition,
      residualGap: comparison.residualGap,
      reasonExistingDesignIsInsufficient: comparison.reasonExistingDesignIsInsufficient,
      recommendation: comparison.recommendation,
      unableToVerifyReason: comparison.unableToVerifyReason,
      scopeDecision,
      rejectedSuggestion,
    };
  });
}
