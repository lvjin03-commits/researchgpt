import { createHash } from "node:crypto";
import { z } from "zod";
import {
  FigureRequestSchema,
  type FigureRequest,
} from "../assets/contracts";
import type { FigureAssetMaterializer } from "../assets/figure-pipeline";
import {
  DocumentPlanSchema,
  DocumentRequestSchema,
  FinalDocumentSpecSchema,
  type DocumentPlan,
  type DocumentRequest,
  type VerifiedReference,
} from "../contracts";
import {
  ComponentValidationResultSchema,
  DocumentOrchestrationStateSchema,
  GeneratedComponentPayloadSchema,
  type ApprovedComponent,
  type ComponentExecutionState,
  type ComponentValidationResult,
  type DocumentOrchestrationState,
  type GeneratedBlockDraft,
  type GeneratedComponentPayload,
  type OrchestrationEvent,
} from "./contracts";

type PlannedComponent = DocumentPlan["components"][number];

export interface ComponentGenerationContext {
  request: DocumentRequest;
  plan: DocumentPlan;
  component: PlannedComponent;
  componentIndex: number;
  attempt: number;
  repairFeedback?: {
    code: string;
    message: string;
  };
  approvedComponents: ReadonlyArray<{
    componentKey: string;
    content: ApprovedComponent;
  }>;
  verifiedReferences: ReadonlyArray<VerifiedReference>;
}

export interface DocumentComponentGenerator {
  generate(
    context: ComponentGenerationContext,
  ): Promise<GeneratedComponentPayload>;
}

export interface DocumentComponentValidator {
  validate(input: {
    request: DocumentRequest;
    plan: DocumentPlan;
    component: PlannedComponent;
    componentIndex: number;
    attempt: number;
    payload: GeneratedComponentPayload;
    approvedComponents: ReadonlyArray<{
      componentKey: string;
      content: ApprovedComponent;
    }>;
    verifiedReferences: ReadonlyArray<VerifiedReference>;
  }): Promise<ComponentValidationResult>;
}

export interface RunDocumentOrchestrationOptions {
  generator: DocumentComponentGenerator;
  validator: DocumentComponentValidator;
  figureAssetMaterializer?: FigureAssetMaterializer;
  maxAttemptsPerComponent?: number;
  maxComponentsPerRun?: number;
}

export class DocumentPlanInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentPlanInvariantError";
  }
}

function appendEvent(
  state: DocumentOrchestrationState,
  event: Omit<OrchestrationEvent, "sequence">,
): void {
  state.events.push({
    sequence: state.events.length + 1,
    ...event,
  });
}

function assertPlanInvariants(
  request: DocumentRequest,
  plan: DocumentPlan,
): void {
  if (request.requestId !== plan.requestId) {
    throw new DocumentPlanInvariantError(
      "Document request and plan IDs do not match.",
    );
  }
  const titleComponents = plan.components.filter(
    (component) => component.type === "title",
  );
  if (titleComponents.length !== 1 || plan.components[0]?.type !== "title") {
    throw new DocumentPlanInvariantError(
      "A document plan must contain exactly one title as its first component.",
    );
  }
  const referenceIndexes = plan.components
    .map((component, index) =>
      component.type === "reference_list" ? index : -1,
    )
    .filter((index) => index >= 0);
  if (
    referenceIndexes.length !== 1 ||
    referenceIndexes[0] !== plan.components.length - 1
  ) {
    throw new DocumentPlanInvariantError(
      "A document plan must contain exactly one reference list as its final component.",
    );
  }
}

export function createDocumentOrchestrationState(input: {
  jobId: string;
  request: DocumentRequest;
  plan: DocumentPlan;
  verifiedReferences?: VerifiedReference[];
}): DocumentOrchestrationState {
  const request = DocumentRequestSchema.parse(input.request);
  const plan = DocumentPlanSchema.parse(input.plan);
  assertPlanInvariants(request, plan);
  return DocumentOrchestrationStateSchema.parse({
    jobId: input.jobId,
    schemaVersion: 1,
    request,
    plan,
    verifiedReferences: input.verifiedReferences ?? [],
    status: "pending",
    currentComponentIndex: 0,
    components: plan.components.map((component) => ({
      componentKey: component.componentKey,
      status: "pending",
      attempts: 0,
    })),
    events: [],
  });
}

function expectedPayloadKind(
  component: PlannedComponent,
): GeneratedComponentPayload["kind"] {
  if (component.type === "title") return "title";
  if (component.type === "reference_list") return "references";
  return "blocks";
}

function validateBlockRoles(
  component: PlannedComponent,
  drafts: GeneratedBlockDraft[],
): void {
  if (
    component.type === "abstract" &&
    (drafts.length !== 1 ||
      drafts[0].type !== "paragraph" ||
      drafts[0].role !== "abstract")
  ) {
    throw new DocumentPlanInvariantError(
      "An abstract component must produce exactly one abstract paragraph.",
    );
  }
  if (
    component.type === "keywords" &&
    (drafts.length !== 1 || drafts[0].type !== "keywords")
  ) {
    throw new DocumentPlanInvariantError(
      "A keywords component must produce exactly one keywords block.",
    );
  }
  if (
    component.type === "conclusion" &&
    !drafts.some(
      (draft) => draft.type === "paragraph" && draft.role === "conclusion",
    )
  ) {
    throw new DocumentPlanInvariantError(
      "A conclusion component must contain a conclusion paragraph.",
    );
  }
  if (
    component.type === "section" &&
    drafts.some(
      (draft) =>
        draft.type === "keywords" ||
        (draft.type === "paragraph" && draft.role === "abstract"),
    )
  ) {
    throw new DocumentPlanInvariantError(
      "A section component cannot produce abstract or keywords blocks.",
    );
  }
}

function structurallyApprovePayload(input: {
  component: PlannedComponent;
  payload: GeneratedComponentPayload;
  approvedComponents: ReadonlyArray<{
    componentKey: string;
    content: ApprovedComponent;
  }>;
  verifiedReferences: ReadonlyArray<VerifiedReference>;
}): {
  approved: ApprovedComponent;
  figureRequests: FigureRequest[];
  paragraphFigureRefs: Array<{
    blockIndex: number;
    requestIndexes: number[];
  }>;
} {
  const expectedKind = expectedPayloadKind(input.component);
  if (input.payload.kind !== expectedKind) {
    throw new DocumentPlanInvariantError(
      `Component "${input.component.componentKey}" must produce ${expectedKind} content.`,
    );
  }

  if (input.payload.kind === "title") {
    return {
      approved: input.payload,
      figureRequests: [],
      paragraphFigureRefs: [],
    };
  }

  if (input.payload.kind === "references") {
    const availableIds = new Set(
      input.verifiedReferences.map((reference) => reference.id),
    );
    for (const referenceId of input.payload.referenceIds) {
      if (!availableIds.has(referenceId)) {
        throw new DocumentPlanInvariantError(
          `Reference "${referenceId}" is not in the verified reference pool.`,
        );
      }
    }
    const selectedIds = new Set(input.payload.referenceIds);
    const citedIds = input.approvedComponents.flatMap(({ content }) =>
      content.kind === "blocks"
        ? content.blocks.flatMap((block) =>
            block.type === "paragraph" ? block.citationIds : [],
          )
        : [],
    );
    for (const citationId of citedIds) {
      if (!selectedIds.has(citationId)) {
        throw new DocumentPlanInvariantError(
          `Reference list does not include cited reference "${citationId}".`,
        );
      }
    }
    const citedIdSet = new Set(citedIds);
    for (const referenceId of selectedIds) {
      if (!citedIdSet.has(referenceId)) {
        throw new DocumentPlanInvariantError(
          `Reference list includes uncited reference "${referenceId}".`,
        );
      }
    }
    return {
      approved: {
        kind: "references",
        referenceIds: [...new Set(input.payload.referenceIds)],
      },
      figureRequests: [],
      paragraphFigureRefs: [],
    };
  }

  const blockPayload = input.payload;
  validateBlockRoles(input.component, blockPayload.blocks);
  const availableReferenceIds = new Set(
    input.verifiedReferences.map((reference) => reference.id),
  );
  for (const draft of blockPayload.blocks) {
    if (draft.type !== "paragraph") continue;
    for (const citationId of draft.citationIds) {
      if (!availableReferenceIds.has(citationId)) {
        throw new DocumentPlanInvariantError(
          `Citation "${citationId}" is not in the verified reference pool.`,
        );
      }
    }
  }
  if (
    blockPayload.figureRequests.length > 0 &&
    input.component.type !== "section" &&
    input.component.type !== "conclusion"
  ) {
    throw new DocumentPlanInvariantError(
      `Component "${input.component.componentKey}" cannot request figures.`,
    );
  }
  const figureRequests = blockPayload.figureRequests.map(
    (draft, index): FigureRequest => {
      if (draft.placementAfterBlockIndex >= blockPayload.blocks.length) {
        throw new DocumentPlanInvariantError(
          `Figure ${index + 1} placement is outside the component block range.`,
        );
      }
      for (const evidenceId of draft.sourceEvidenceIds) {
        if (!availableReferenceIds.has(evidenceId)) {
          throw new DocumentPlanInvariantError(
            `Figure ${index + 1} references unverified evidence "${evidenceId}".`,
          );
        }
      }
      if (
        draft.figureType === "data_plot" &&
        draft.sourceEvidenceIds.length === 0
      ) {
        throw new DocumentPlanInvariantError(
          `Data plot ${index + 1} requires verified source evidence.`,
        );
      }
      return FigureRequestSchema.parse({
        ...draft,
        requestId: stableFigureRequestId(
          input.component.componentKey,
          index,
        ),
        componentKey: input.component.componentKey,
      });
    },
  );
  const paragraphFigureRefs = blockPayload.blocks.flatMap((block, blockIndex) => {
    if (block.type !== "paragraph" || block.figureRequestIndexes.length === 0) {
      return [];
    }
    for (const requestIndex of block.figureRequestIndexes) {
      if (requestIndex >= figureRequests.length) {
        throw new DocumentPlanInvariantError(
          `Paragraph ${blockIndex + 1} references missing figure request ${requestIndex}.`,
        );
      }
    }
    return [
      {
        blockIndex,
        requestIndexes: [...new Set(block.figureRequestIndexes)],
      },
    ];
  });
  return {
    approved: {
      kind: "blocks",
      blocks: blockPayload.blocks.map((block, index) => {
        if (block.type !== "paragraph") {
          return {
            ...block,
            id: `${input.component.componentKey}-${index + 1}`,
          };
        }
        const { figureRequestIndexes: _figureRequestIndexes, ...paragraph } =
          block;
        return {
          ...paragraph,
          id: `${input.component.componentKey}-${index + 1}`,
          figureAssetIds: [],
        };
      }),
      assets: [],
    },
    figureRequests,
    paragraphFigureRefs,
  };
}

function stableFigureRequestId(componentKey: string, index: number): string {
  const digest = createHash("sha256")
    .update(`${componentKey}:${index}`)
    .digest("hex")
    .slice(0, 24);
  return `figure-${digest}`;
}

async function materializeFigures(input: {
  approved: ApprovedComponent;
  requests: FigureRequest[];
  paragraphFigureRefs: Array<{
    blockIndex: number;
    requestIndexes: number[];
  }>;
  materializer?: FigureAssetMaterializer;
}): Promise<ApprovedComponent> {
  if (input.requests.length === 0) return input.approved;
  if (input.approved.kind !== "blocks") {
    throw new DocumentPlanInvariantError(
      "Only block components can materialize figures.",
    );
  }
  if (!input.materializer) {
    throw new DocumentPlanInvariantError(
      "Figure requests require a configured figure asset materializer.",
    );
  }
  const assets = [];
  for (const request of input.requests) {
    const asset = await input.materializer.materialize(request);
    if (asset.requestId !== request.requestId) {
      throw new DocumentPlanInvariantError(
        `Figure asset request ID "${asset.requestId}" does not match "${request.requestId}".`,
      );
    }
    assets.push(asset);
  }
  const requestsByPlacement = new Map<number, FigureRequest[]>();
  for (const request of input.requests) {
    const requests = requestsByPlacement.get(
      request.placementAfterBlockIndex,
    );
    if (requests) requests.push(request);
    else requestsByPlacement.set(request.placementAfterBlockIndex, [request]);
  }
  const assetByRequest = new Map(
    assets.map((asset) => [asset.requestId, asset]),
  );
  const paragraphRefsByBlock = new Map(
    input.paragraphFigureRefs.map((reference) => [
      reference.blockIndex,
      reference.requestIndexes,
    ]),
  );
  const blocks = input.approved.blocks.flatMap((originalBlock, index) => {
    const requestIndexes = paragraphRefsByBlock.get(index) ?? [];
    const block =
      originalBlock.type === "paragraph"
        ? {
            ...originalBlock,
            figureAssetIds: requestIndexes.map(
              (requestIndex) =>
                assetByRequest.get(input.requests[requestIndex].requestId)!.id,
            ),
          }
        : originalBlock;
    return [
      block,
    ...(requestsByPlacement.get(index) ?? []).map((request) => ({
      id: `${request.requestId}-block`,
      type: "figure" as const,
      caption: request.caption,
      assetId: assetByRequest.get(request.requestId)!.id,
    })),
    ];
  });
  return { kind: "blocks", blocks, assets };
}

function approvedBefore(
  state: DocumentOrchestrationState,
  componentIndex: number,
): Array<{ componentKey: string; content: ApprovedComponent }> {
  return state.components
    .slice(0, componentIndex)
    .flatMap((component) =>
      component.approved
        ? [{ componentKey: component.componentKey, content: component.approved }]
        : [],
    );
}

function failJob(
  state: DocumentOrchestrationState,
  componentState: ComponentExecutionState,
  code: string,
  message: string,
): void {
  componentState.status = "failed";
  componentState.lastError = { code, message };
  state.status = "failed";
  state.failure = {
    code,
    message,
    componentKey: componentState.componentKey,
  };
  appendEvent(state, {
    type: "job_failed",
    componentKey: componentState.componentKey,
    attempt: componentState.attempts,
    code,
    message,
  });
}

function buildFinalSpec(state: DocumentOrchestrationState) {
  const titleComponent = state.components.find(
    (component) => component.approved?.kind === "title",
  )?.approved;
  if (!titleComponent || titleComponent.kind !== "title") {
    throw new DocumentPlanInvariantError(
      "Approved orchestration has no document title.",
    );
  }

  const blocks = state.components.flatMap((component) =>
    component.approved?.kind === "blocks" ? component.approved.blocks : [],
  );
  const assets = state.components.flatMap((component) =>
    component.approved?.kind === "blocks" ? component.approved.assets : [],
  );
  const referenceSelection = state.components.find(
    (component) => component.approved?.kind === "references",
  )?.approved;
  const selectedReferenceIds =
    referenceSelection?.kind === "references"
      ? referenceSelection.referenceIds
      : [];
  const citedReferenceIds = blocks.flatMap((block) =>
    block.type === "paragraph" ? block.citationIds : [],
  );
  const orderedReferenceIds = [
    ...new Set([...citedReferenceIds, ...selectedReferenceIds]),
  ];
  const verifiedReferenceById = new Map(
    state.verifiedReferences.map((reference) => [reference.id, reference]),
  );
  const references = orderedReferenceIds.flatMap((referenceId) => {
    const reference = verifiedReferenceById.get(referenceId);
    return reference ? [reference] : [];
  });

  return FinalDocumentSpecSchema.parse({
    requestId: state.request.requestId,
    schemaVersion: 1,
    templateSnapshot: state.plan.templateSnapshot,
    metadata: {
      title: titleComponent.title,
      language: state.request.language,
      documentType: "sci_review",
      referencesStatus: references.length > 0 ? "verified" : "not_available",
    },
    blocks,
    references,
    assets,
  });
}

export async function runDocumentOrchestration(
  inputState: DocumentOrchestrationState,
  options: RunDocumentOrchestrationOptions,
): Promise<DocumentOrchestrationState> {
  const state = DocumentOrchestrationStateSchema.parse(
    structuredClone(inputState),
  );
  if (state.status === "completed" || state.status === "failed") {
    return state;
  }

  const maxAttempts = options.maxAttemptsPerComponent ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new RangeError("maxAttemptsPerComponent must be between 1 and 10.");
  }
  const maxComponents = options.maxComponentsPerRun ?? Number.POSITIVE_INFINITY;
  if (
    maxComponents !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxComponents) || maxComponents < 1)
  ) {
    throw new RangeError("maxComponentsPerRun must be a positive integer.");
  }

  if (state.events.length === 0) {
    appendEvent(state, { type: "job_started" });
  }
  state.status = "running";
  let approvedThisRun = 0;

  while (state.currentComponentIndex < state.plan.components.length) {
    if (approvedThisRun >= maxComponents) {
      state.status = "paused";
      appendEvent(state, { type: "job_paused" });
      return DocumentOrchestrationStateSchema.parse(state);
    }

    const componentIndex = state.currentComponentIndex;
    const component = state.plan.components[componentIndex];
    const componentState = state.components[componentIndex];
    const approvedComponents = approvedBefore(state, componentIndex);

    componentState.status = "running";
    componentState.attempts += 1;
    appendEvent(state, {
      type: "component_started",
      componentKey: component.componentKey,
      attempt: componentState.attempts,
    });

    let payload: GeneratedComponentPayload;
    try {
      payload = GeneratedComponentPayloadSchema.parse(
        await options.generator.generate({
          request: state.request,
          plan: state.plan,
          component,
          componentIndex,
          attempt: componentState.attempts,
          repairFeedback: componentState.lastError
            ? {
                code: componentState.lastError.code,
                message: componentState.lastError.message,
              }
            : undefined,
          approvedComponents,
          verifiedReferences: state.verifiedReferences,
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown generation failure.";
      componentState.lastError = {
        code: "component_generation_failed",
        message,
      };
      appendEvent(state, {
        type: "component_rejected",
        componentKey: component.componentKey,
        attempt: componentState.attempts,
        code: componentState.lastError.code,
        message,
      });
      if (componentState.attempts >= maxAttempts) {
        failJob(
          state,
          componentState,
          componentState.lastError.code,
          message,
        );
        return DocumentOrchestrationStateSchema.parse(state);
      }
      continue;
    }

    let structuralApproval: {
      approved: ApprovedComponent;
      figureRequests: FigureRequest[];
      paragraphFigureRefs: Array<{
        blockIndex: number;
        requestIndexes: number[];
      }>;
    };
    try {
      structuralApproval = structurallyApprovePayload({
        component,
        payload,
        approvedComponents,
        verifiedReferences: state.verifiedReferences,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid component structure.";
      componentState.lastError = {
        code: "component_structure_invalid",
        message,
      };
      appendEvent(state, {
        type: "component_rejected",
        componentKey: component.componentKey,
        attempt: componentState.attempts,
        code: componentState.lastError.code,
        message,
      });
      if (componentState.attempts >= maxAttempts) {
        failJob(
          state,
          componentState,
          componentState.lastError.code,
          message,
        );
        return DocumentOrchestrationStateSchema.parse(state);
      }
      continue;
    }

    let validation: ComponentValidationResult;
    try {
      validation = ComponentValidationResultSchema.parse(
        await options.validator.validate({
          request: state.request,
          plan: state.plan,
          component,
          componentIndex,
          attempt: componentState.attempts,
          payload,
          approvedComponents,
          verifiedReferences: state.verifiedReferences,
        }),
      );
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? z.prettifyError(error)
          : error instanceof Error
            ? error.message
            : "Unknown validation failure.";
      validation = {
        accepted: false,
        code: "component_validation_failed",
        feedback: message,
      };
    }

    if (!validation.accepted) {
      componentState.lastError = {
        code: validation.code,
        message: validation.feedback,
      };
      appendEvent(state, {
        type: "component_rejected",
        componentKey: component.componentKey,
        attempt: componentState.attempts,
        code: validation.code,
        message: validation.feedback,
      });
      if (componentState.attempts >= maxAttempts) {
        failJob(
          state,
          componentState,
          validation.code,
          validation.feedback,
        );
        return DocumentOrchestrationStateSchema.parse(state);
      }
      continue;
    }

    let approved: ApprovedComponent;
    try {
      approved = await materializeFigures({
        approved: structuralApproval.approved,
        requests: structuralApproval.figureRequests,
        paragraphFigureRefs: structuralApproval.paragraphFigureRefs,
        materializer: options.figureAssetMaterializer,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Figure asset generation failed.";
      failJob(
        state,
        componentState,
        "figure_asset_generation_failed",
        message,
      );
      return DocumentOrchestrationStateSchema.parse(state);
    }

    componentState.status = "approved";
    componentState.approved = approved;
    componentState.lastError = undefined;
    appendEvent(state, {
      type: "component_approved",
      componentKey: component.componentKey,
      attempt: componentState.attempts,
    });
    state.currentComponentIndex += 1;
    approvedThisRun += 1;
  }

  try {
    state.finalSpec = buildFinalSpec(state);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? z.prettifyError(error)
        : error instanceof Error
          ? error.message
          : "Final document assembly failed.";
    state.status = "failed";
    state.failure = {
      code: "final_document_invalid",
      message,
    };
    appendEvent(state, {
      type: "job_failed",
      code: state.failure.code,
      message,
    });
    return DocumentOrchestrationStateSchema.parse(state);
  }

  state.status = "completed";
  appendEvent(state, { type: "job_completed" });
  return DocumentOrchestrationStateSchema.parse(state);
}
