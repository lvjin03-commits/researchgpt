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
  DocumentSkeletonDraftSchema,
  DocumentSkeletonSchema,
  SectionPlanDraftSchema,
  SectionPlanSchema,
  SemanticOutlineProposalSchema,
  type DocumentSkeleton,
  type SectionPlan,
  type SemanticOutlineProposal,
} from "./contracts";

export interface HierarchicalOutlinePlanner {
  createSkeleton(input: {
    request: DocumentRequest;
    template: TemplateResolution;
    minimumSections: number;
    maximumSections: number;
  }): Promise<unknown>;
  planSection(input: {
    request: DocumentRequest;
    template: TemplateResolution;
    skeleton: DocumentSkeleton;
    section: DocumentSkeleton["sections"][number];
    availableEvidenceIds: ReadonlyArray<string>;
  }): Promise<unknown>;
}

/** Compatibility contract for archived source snapshots; the production route uses HierarchicalOutlinePlanner. */
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

export function materializeDocumentSkeleton(input: unknown): DocumentSkeleton {
  const draft = DocumentSkeletonDraftSchema.parse(input);
  return DocumentSkeletonSchema.parse({
    ...draft,
    schemaVersion: 1,
    sections: draft.sections.map((section, order) => ({
      ...section,
      sectionId: `section-${String(order + 1).padStart(2, "0")}`,
      order,
    })),
    figures: draft.figures.map((figure, index) => ({
      ...figure,
      figureIntentId: `figure-intent-${String(index + 1).padStart(2, "0")}`,
    })),
  });
}

export function materializeSectionPlan(input: {
  sectionId: string;
  draft: unknown;
}): SectionPlan {
  return SectionPlanSchema.parse({
    ...SectionPlanDraftSchema.parse(input.draft),
    schemaVersion: 1,
    sectionId: input.sectionId,
    skeletonVersion: 1,
  });
}

export function assembleSemanticOutline(input: {
  skeleton: DocumentSkeleton;
  sectionPlans: SectionPlan[];
}): SemanticOutlineProposal {
  const plans = new Map(input.sectionPlans.map((plan) => [plan.sectionId, plan]));
  if (plans.size !== input.skeleton.sections.length) {
    throw new DocumentPlanningError("Every skeleton section requires exactly one section plan.");
  }
  return SemanticOutlineProposalSchema.parse({
    reviewThesis: input.skeleton.reviewThesis,
    scopeBoundary: input.skeleton.scopeBoundary,
    reviewQuestions: input.skeleton.reviewQuestions,
    conclusionHeading: input.skeleton.conclusionHeading,
    sections: input.skeleton.sections.map((section) => {
      const plan = plans.get(section.sectionId);
      if (!plan) throw new DocumentPlanningError(`Missing plan for ${section.sectionId}.`);
      return {
        heading: section.heading,
        question: section.question,
        purpose: section.purpose,
        relativeWeight: section.relativeWeight,
        contributionToThesis: plan.contributionToThesis,
        comparisonDimensions: plan.comparisonDimensions,
        applicableConditions: plan.applicableConditions,
        failureModes: plan.failureModes,
        requiredEvidenceIds: plan.requiredEvidenceIds,
      };
    }),
    figures: input.skeleton.figures.map((figure) => {
      const section = input.skeleton.sections[figure.sectionIndex];
      const plan = section ? plans.get(section.sectionId) : undefined;
      return {
        sectionIndex: figure.sectionIndex,
        figureType: figure.figureType,
        purpose: figure.purpose,
        questionAnswered: figure.questionAnswered,
        claimsRepresented: figure.claimsRepresented,
        requiredEvidenceIds: figure.evidenceRequired ? (plan?.requiredEvidenceIds ?? []) : [],
      };
    }),
  });
}

function outlineSemanticErrors(
  proposal: SemanticOutlineProposal,
  availableEvidenceIds: ReadonlySet<string>,
  language: DocumentRequest["language"],
): string[] {
  const errors: string[] = [];
  proposal.sections.forEach((section, index) => {
    const label = `Section ${index + 1}`;
    const cjkCharacters = section.heading.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    const latinCharacters = section.heading.match(/[A-Za-z]/g)?.length ?? 0;
    if (
      (language === "zh" && cjkCharacters === 0 && latinCharacters >= 8) ||
      (language === "en" && cjkCharacters >= 4 && latinCharacters === 0)
    ) {
      errors.push(
        `${label} heading does not use the requested ${language} document language.`,
      );
    }
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
  proposal.figures.forEach((figure, index) => {
    const label = `Figure ${index + 1}`;
    if (figure.figureType === "data_plot") {
      errors.push(
        `${label} selects data_plot, but no verified dataset asset is available. Choose a permitted non-quantitative figure type only when it preserves the purpose, otherwise omit the figure.`,
      );
    }
    figure.requiredEvidenceIds.forEach((evidenceId) => {
      if (!availableEvidenceIds.has(evidenceId)) {
        errors.push(
          `${label} references unavailable evidence "${evidenceId}".`,
        );
      }
    });
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

export function createDocumentPlanFromProposal(input: {
  request: DocumentRequest;
  template: TemplateResolution;
  proposal: SemanticOutlineProposal;
  availableEvidenceIds?: string[];
}): DocumentPlan {
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
  const proposal = SemanticOutlineProposalSchema.parse(input.proposal);
  const semanticErrors = outlineSemanticErrors(proposal, availableEvidenceSet, request.language);
  if (semanticErrors.length > 0) {
    throw new DocumentPlanningError(
      `Outline does not contain valid body sections. ${semanticErrors.join(" ")}`,
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
          question: section.question,
          purpose: section.purpose,
          contributionToThesis: section.contributionToThesis,
          comparisonDimensions: section.comparisonDimensions,
          applicableConditions: section.applicableConditions,
          failureModes: section.failureModes,
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
      comparisonDimensions: [],
      applicableConditions: [],
      failureModes: [],
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
    reviewThesis: proposal.reviewThesis,
    scopeBoundary: proposal.scopeBoundary,
    reviewQuestions: proposal.reviewQuestions,
    components: componentsWithDependencies,
    figureSlots: proposal.figures.map((figure, index) => ({
      slotId: `figure-slot-${String(index + 1).padStart(2, "0")}`,
      componentKey: `section-${String(figure.sectionIndex + 1).padStart(2, "0")}`,
      figureType: figure.figureType,
      purpose: figure.purpose,
      questionAnswered: figure.questionAnswered,
      evidenceMode:
        figure.requiredEvidenceIds.length > 0 ? "verified" : "conceptual",
      claimsRepresented: figure.claimsRepresented,
      requiredEvidenceIds: figure.requiredEvidenceIds,
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

export async function createDocumentPlanFromTemplate(input: {
  request: DocumentRequest;
  template: TemplateResolution;
  outlinePlanner: SemanticOutlinePlanner;
  availableEvidenceIds?: string[];
}): Promise<DocumentPlan> {
  const minimumSections = input.template.componentBlueprints.find((item) => item.type === "section")?.minimumCount ?? 1;
  const maximumSections = input.template.componentBlueprints.find((item) => item.type === "section")?.maximumCount ?? 100;
  let repairFeedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const proposal = await input.outlinePlanner.propose({
      request: input.request, template: input.template, minimumSections, maximumSections,
      availableEvidenceIds: input.availableEvidenceIds ?? [], repairFeedback,
    });
    try {
      return createDocumentPlanFromProposal({ ...input, proposal });
    } catch (error) {
      if (!(error instanceof DocumentPlanningError) || attempt === 1) throw error;
      repairFeedback = error.message;
    }
  }
  throw new DocumentPlanningError("Outline planning failed.");
}
