import { z } from "zod";
import type { GrantResearchSourceGroup, GrantResearchSourceMember } from "./research-source-acquisition.ts";

const UuidSchema = z.string().uuid();

export const GrantResearchQuantitativeFindingSchema = z.object({
  statement: z.string().trim().min(1).max(1000),
  sourceIds: z.array(UuidSchema).min(1).max(5),
}).strict();

export const GrantResearchSourceAssessmentV2Schema = z.object({
  sourceGroupId: UuidSchema,
  disposition: z.enum(["recommended", "excluded"]),
  reason: z.string().trim().min(1).max(500),
  mechanismSummary: z.string().trim().min(1).max(1500).nullable(),
  quantitativeFindings: z.array(GrantResearchQuantitativeFindingSchema).max(10),
  applicationRelation: z.string().trim().min(1).max(1500).nullable(),
  evidenceLimitations: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict();

export const GrantResearchSourceAssessmentProposalV2Schema = z.object({
  schemaVersion: z.literal(2),
  assessments: z.array(GrantResearchSourceAssessmentV2Schema).max(25),
}).strict();

export type GrantResearchSourceAssessmentV2 = z.infer<typeof GrantResearchSourceAssessmentV2Schema>;

export type GrantResearchSourceAssessmentView = GrantResearchSourceAssessmentV2 & {
  publicationYear: number | null;
  doi: string | null;
  primarySourceId: string;
};

function memberEvidence(member: GrantResearchSourceMember): string | null {
  if (member.sourceKind === "structured_academic") return member.record.evidence.text;
  return member.record.snippet;
}

function numericTokens(value: string): string[] {
  return [...value.normalize("NFKC").matchAll(/(?<![\p{L}\p{N}])[-+]?\d+(?:[.,]\d+)*(?:\s?(?:%|wt%|mA|mAh|A|V|mV|h|s|ms|K|°C|mS\s?cm[-−]?1))?/giu)]
    .map((match) => match[0].replace(/\s+/gu, "").replace(/,/gu, "").replace(/−/gu, "-").toLowerCase());
}

function evidenceContainsToken(evidence: string, token: string): boolean {
  const normalized = evidence.normalize("NFKC").replace(/\s+/gu, "").replace(/,/gu, "")
    .replace(/−/gu, "-").toLowerCase();
  return normalized.includes(token);
}

function programMetadata(group: GrantResearchSourceGroup) {
  const academic = group.members.find((member) => member.sourceKind === "structured_academic");
  return {
    publicationYear: academic?.sourceKind === "structured_academic" ? academic.record.publication.publicationYear : null,
    doi: academic?.sourceKind === "structured_academic" ? academic.record.publication.doi : null,
  };
}

export function validateGrantResearchSourceAssessments(input: {
  proposal: unknown;
  sourceGroups: readonly GrantResearchSourceGroup[];
}): GrantResearchSourceAssessmentView[] {
  const proposal = GrantResearchSourceAssessmentProposalV2Schema.parse(input.proposal);
  const groups = new Map(input.sourceGroups.map((group) => [group.groupId, group]));
  if (groups.size !== input.sourceGroups.length) throw new Error("Research source group IDs must be unique.");
  const assessmentIds = proposal.assessments.map((assessment) => assessment.sourceGroupId);
  if (new Set(assessmentIds).size !== assessmentIds.length) throw new Error("A research source group may be assessed only once.");
  if (assessmentIds.length !== groups.size || assessmentIds.some((id) => !groups.has(id))) {
    throw new Error("Every current research source group must be assessed exactly once.");
  }

  return proposal.assessments.map((assessment) => {
    const group = groups.get(assessment.sourceGroupId)!;
    const memberById = new Map(group.members.map((member) => [member.record.sourceId, member]));
    if (assessment.disposition === "recommended" && !assessment.mechanismSummary && !assessment.applicationRelation) {
      throw new Error("A recommended research source requires a mechanism summary or application relation.");
    }
    for (const finding of assessment.quantitativeFindings) {
      if (finding.sourceIds.length !== new Set(finding.sourceIds).size) throw new Error("A quantitative finding cannot repeat a source ID.");
      const evidence = finding.sourceIds.map((sourceId) => {
        const member = memberById.get(sourceId);
        if (!member) throw new Error("A quantitative finding references a source outside its research-source group.");
        return memberEvidence(member);
      }).filter((value): value is string => Boolean(value)).join("\n");
      const tokens = numericTokens(finding.statement);
      if (tokens.length === 0) throw new Error("A quantitative finding must contain at least one numeric value.");
      const unsupported = tokens.filter((token) => !evidenceContainsToken(evidence, token));
      if (unsupported.length > 0) throw new Error(`Quantitative finding contains unsupported values: ${unsupported.join(", ")}.`);
    }
    const metadata = programMetadata(group);
    return { ...assessment, ...metadata, primarySourceId: group.primarySourceId };
  });
}
