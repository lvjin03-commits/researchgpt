import {
  DocumentPlanSchema,
  DocumentRequestSchema,
  type DocumentPlan,
  type DocumentRequest,
} from "../contracts";
import {
  TemplateResolutionSchema,
  type TemplateResolution,
} from "../templates/contracts";
import {
  SemanticOutlineProposalSchema,
  type SemanticOutlineProposal,
} from "./contracts";

export interface SemanticOutlinePlanner {
  propose(input: {
    request: DocumentRequest;
    template: TemplateResolution;
    minimumSections: number;
    maximumSections: number;
    availableEvidenceIds: ReadonlyArray<string>;
  }): Promise<SemanticOutlineProposal>;
}

export class DocumentPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPlanningError";
  }
}

function allocateByWeight(
  total: number,
  weights: number[],
): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => (total * weight) / weightTotal);
  const allocated = raw.map((value) => Math.max(1, Math.floor(value)));
  let remaining = total - allocated.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);
  let cursor = 0;
  while (remaining > 0) {
    allocated[order[cursor % order.length].index] += 1;
    remaining -= 1;
    cursor += 1;
  }
  while (remaining < 0) {
    const candidate = order
      .slice()
      .reverse()
      .find(({ index }) => allocated[index] > 1);
    if (!candidate) break;
    allocated[candidate.index] -= 1;
    remaining += 1;
  }
  return allocated;
}

export async function createDocumentPlanFromTemplate(input: {
  request: DocumentRequest;
  template: TemplateResolution;
  outlinePlanner: SemanticOutlinePlanner;
  availableEvidenceIds?: string[];
}): Promise<DocumentPlan> {
  const request = DocumentRequestSchema.parse(input.request);
  const template = TemplateResolutionSchema.parse(input.template);
  const sectionBlueprint = template.componentBlueprints.find(
    (component) => component.type === "section",
  );
  if (!sectionBlueprint) {
    throw new DocumentPlanningError(
      "Resolved template does not contain a section blueprint.",
    );
  }
  const availableEvidenceIds = [...new Set(input.availableEvidenceIds ?? [])];
  const availableEvidenceSet = new Set(availableEvidenceIds);
  const proposal = SemanticOutlineProposalSchema.parse(
    await input.outlinePlanner.propose({
      request,
      template,
      minimumSections: sectionBlueprint.minimumCount,
      maximumSections: sectionBlueprint.maximumCount,
      availableEvidenceIds,
    }),
  );
  if (
    proposal.sections.length < sectionBlueprint.minimumCount ||
    proposal.sections.length > sectionBlueprint.maximumCount
  ) {
    throw new DocumentPlanningError(
      `Outline proposed ${proposal.sections.length} sections; template allows ${sectionBlueprint.minimumCount}-${sectionBlueprint.maximumCount}.`,
    );
  }
  for (const section of proposal.sections) {
    for (const evidenceId of section.requiredEvidenceIds) {
      if (!availableEvidenceSet.has(evidenceId)) {
        throw new DocumentPlanningError(
          `Outline referenced unavailable evidence "${evidenceId}".`,
        );
      }
    }
  }

  const targetLength = request.userRequirements.targetLength ?? 4_000;
  const abstractLength = Math.max(1, Math.round(targetLength * 0.1));
  const conclusionLength = Math.max(1, Math.round(targetLength * 0.1));
  const sectionBudget = Math.max(
    proposal.sections.length,
    targetLength - abstractLength - conclusionLength,
  );
  const sectionLengths = allocateByWeight(
    sectionBudget,
    proposal.sections.map((section) => section.relativeWeight),
  );

  const components: DocumentPlan["components"] = [];
  for (const blueprint of template.componentBlueprints) {
    if (blueprint.type === "section") {
      proposal.sections.forEach((section, index) => {
        components.push({
          componentKey: `section-${String(index + 1).padStart(2, "0")}`,
          type: "section",
          heading: section.heading,
          purpose: section.purpose,
          targetLength: sectionLengths[index],
          requiredEvidenceIds:
            section.requiredEvidenceIds.length > 0
              ? section.requiredEvidenceIds
              : undefined,
        });
      });
      continue;
    }
    if (!blueprint.required) continue;
    components.push({
      componentKey: blueprint.componentKey,
      type: blueprint.type,
      purpose: blueprint.purpose,
      heading:
        blueprint.type === "conclusion"
          ? proposal.conclusionHeading
          : undefined,
      targetLength:
        blueprint.type === "abstract"
          ? abstractLength
          : blueprint.type === "conclusion"
            ? conclusionLength
            : undefined,
    });
  }

  return DocumentPlanSchema.parse({
    requestId: request.requestId,
    schemaVersion: 1,
    templateSnapshot: template.snapshot,
    components,
    evidenceRequirements: availableEvidenceIds.map((evidenceId) => ({
      claimType: `evidence-${evidenceId}`,
      required: proposal.sections.some((section) =>
        section.requiredEvidenceIds.includes(evidenceId),
      ),
      allowedSourceIds: [evidenceId],
    })),
  });
}
