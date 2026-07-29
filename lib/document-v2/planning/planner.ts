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
    repairFeedback?: string;
  }): Promise<SemanticOutlineProposal>;
}

export class DocumentPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPlanningError";
  }
}

const FIXED_COMPONENT_HEADING_PATTERN =
  /^(?:title|abstract|keywords?|references?|标题|摘要|关键词|参考文献)$/i;
const FIXED_COMPONENT_DIRECTIVE_PATTERN =
  /(?:(?:生成|给出|撰写|编写|提取|列出|创建|决定).{0,16}(?:标题|摘要|关键词|参考文献)|(?:generate|write|create|provide|extract|select).{0,32}(?:title|abstract|keywords?|reference list))/i;
const ASSET_SPECIFICATION_PATTERN =
  /(?:^|\n)\s*(?:图|表|fig(?:ure)?|table)\s*\d+\s*[（(:：]/im;
const MAX_SECTION_PURPOSE_CHARACTERS = 650;
const MAX_SUBSECTION_MARKERS_PER_SECTION = 4;
const MAX_OUTLINE_ATTEMPTS = 2;

function outlineSemanticErrors(
  proposal: SemanticOutlineProposal,
): string[] {
  const errors: string[] = [];
  proposal.sections.forEach((section, index) => {
    const label = `Section ${index + 1}`;
    if (
      FIXED_COMPONENT_HEADING_PATTERN.test(section.heading) ||
      FIXED_COMPONENT_DIRECTIVE_PATTERN.test(section.heading) ||
      FIXED_COMPONENT_DIRECTIVE_PATTERN.test(section.purpose)
    ) {
      errors.push(
        `${label} assigns title, abstract, keywords, or references work to a body section.`,
      );
    }
    if (section.purpose.length > MAX_SECTION_PURPOSE_CHARACTERS) {
      errors.push(
        `${label} purpose is too detailed; keep it under ${MAX_SECTION_PURPOSE_CHARACTERS} characters and split the scientific scope across sections.`,
      );
    }
    if (ASSET_SPECIFICATION_PATTERN.test(section.purpose)) {
      errors.push(
        `${label} contains numbered figure or table production instructions; the outline may describe scientific scope but not asset specifications.`,
      );
    }
    const subsectionMarkers =
      section.purpose.match(/(?:^|\s)\d+\.\d+(?:\s|$)/g)?.length ?? 0;
    if (subsectionMarkers > MAX_SUBSECTION_MARKERS_PER_SECTION) {
      errors.push(
        `${label} contains ${subsectionMarkers} subsection directives; split it into smaller body sections.`,
      );
    }
  });
  return errors;
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
  let proposal: SemanticOutlineProposal | undefined;
  let repairFeedback: string | undefined;
  for (let attempt = 1; attempt <= MAX_OUTLINE_ATTEMPTS; attempt += 1) {
    const candidate = SemanticOutlineProposalSchema.parse(
      await input.outlinePlanner.propose({
        request,
        template,
        minimumSections: sectionBlueprint.minimumCount,
        maximumSections: sectionBlueprint.maximumCount,
        availableEvidenceIds,
        repairFeedback,
      }),
    );
    const semanticErrors = outlineSemanticErrors(candidate);
    if (semanticErrors.length === 0) {
      proposal = candidate;
      break;
    }
    repairFeedback = semanticErrors.join(" ");
  }
  if (!proposal) {
    throw new DocumentPlanningError(
      `Outline does not contain valid body sections. ${repairFeedback ?? ""}`.trim(),
    );
  }
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
          dependsOnComponentKeys: [],
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
      dependsOnComponentKeys: [],
    });
  }

  const sectionKeys = components
    .filter((component) => component.type === "section")
    .map((component) => component.componentKey);
  const allContentKeys = components
    .filter((component) => component.type !== "reference_list")
    .map((component) => component.componentKey);
  const componentsWithDependencies = components.map((component) => ({
    ...component,
    dependsOnComponentKeys:
      component.type === "section"
        ? []
        : component.type === "conclusion"
          ? sectionKeys
          : component.type === "abstract"
            ? [...sectionKeys, "conclusion"]
            : component.type === "keywords"
              ? ["abstract"]
              : component.type === "title"
                ? ["abstract", "keywords", "conclusion"]
                : allContentKeys,
  }));

  return DocumentPlanSchema.parse({
    requestId: request.requestId,
    schemaVersion: 1,
    templateSnapshot: template.snapshot,
    components: componentsWithDependencies,
    figureSlots: proposal.figures.map((figure, index) => ({
      slotId: `figure-slot-${String(index + 1).padStart(2, "0")}`,
      componentKey: `section-${String(figure.sectionIndex + 1).padStart(2, "0")}`,
      figureType: figure.figureType,
      purpose: figure.purpose,
    })),
    figurePlanningCompleted: true,
    evidenceRequirements: availableEvidenceIds.map((evidenceId) => ({
      claimType: `evidence-${evidenceId}`,
      required: proposal.sections.some((section) =>
        section.requiredEvidenceIds.includes(evidenceId),
      ),
      allowedSourceIds: [evidenceId],
    })),
  });
}
