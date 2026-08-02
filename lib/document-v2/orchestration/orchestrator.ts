import { createHash } from "node:crypto";
import { z } from "zod";
import {
  FigureRequestSchema,
  type FigureRequest,
} from "../assets/contracts";
import type { FigureAssetMaterializer } from "../assets/figure-pipeline";
import {
  createFigureLabelSpecs,
  resolveFigureRenderStrategy,
} from "../assets/render-policy";
import { normalizeGeneratedComponentContent } from "../generation/content-normalizer";
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
  figureSlots: ReadonlyArray<DocumentPlan["figureSlots"][number]>;
  generationRevision: number;
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
  evidenceBundle: ReadonlyArray<{
    evidenceId: string;
    excerpt: string;
    locator?: { page?: number; section?: string };
  }>;
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
  maxTransientFailuresPerComponent?: number;
  maxComponentsPerRun?: number;
  maxFigureAttempts?: number;
  maxFigureAssetsPerDocument?: number;
  onFigureProviderCall?: () => void;
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
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(plan.components.map((component) => [component.componentKey, component]));
  const visit = (key: string) => {
    if (visiting.has(key)) {
      throw new DocumentPlanInvariantError("Document component dependencies contain a cycle.");
    }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOnComponentKeys ?? []) {
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };
  plan.components.forEach((component) => visit(component.componentKey));
}

export function createDocumentOrchestrationState(input: {
  jobId: string;
  request: DocumentRequest;
  plan: DocumentPlan;
  verifiedReferences?: VerifiedReference[];
  evidenceBundle?: Array<{
    evidenceId: string;
    excerpt: string;
    locator?: { page?: number; section?: string };
  }>;
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
    evidenceBundle: input.evidenceBundle ?? [],
    status: "pending",
    currentComponentIndex: Math.max(
      0,
      plan.components.findIndex(
        (component) => component.dependsOnComponentKeys.length === 0,
      ),
    ),
    components: plan.components.map((component) => ({
      componentKey: component.componentKey,
      status: "pending",
      attempts: 0,
      transientFailures: 0,
    })),
    figures: [],
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
  plan: DocumentPlan;
  documentLanguage: "zh" | "en";
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
    if (
      draft.role === "abstract" &&
      !input.plan.templateSnapshot.citationPolicy.includeAbstract &&
      draft.citationIds.length > 0
    ) {
      throw new DocumentPlanInvariantError(
        "The selected template forbids citations in the abstract.",
      );
    }
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
  const plannedSlots = input.plan.figureSlots.filter(
    (slot) => slot.componentKey === input.component.componentKey,
  );
  if (plannedSlots.length > 0) {
    const plannedSlotById = new Map(
      plannedSlots.map((slot) => [slot.slotId, slot]),
    );
    const returnedSlotIds = new Set<string>();
    for (const [index, draft] of blockPayload.figureRequests.entries()) {
      if (!draft.slotId || !plannedSlotById.has(draft.slotId)) {
        throw new DocumentPlanInvariantError(
          `Figure ${index + 1} must complete a figure slot planned for component "${input.component.componentKey}".`,
        );
      }
      if (returnedSlotIds.has(draft.slotId)) {
        throw new DocumentPlanInvariantError(
          `Figure slot "${draft.slotId}" was returned more than once.`,
        );
      }
      const plannedSlot = plannedSlotById.get(draft.slotId)!;
      if (draft.figureType !== plannedSlot.figureType) {
        throw new DocumentPlanInvariantError(
          `Figure slot "${draft.slotId}" must use type "${plannedSlot.figureType}".`,
        );
      }
      returnedSlotIds.add(draft.slotId);
    }
    if (returnedSlotIds.size !== plannedSlots.length) {
      throw new DocumentPlanInvariantError(
        `Component "${input.component.componentKey}" must complete all ${plannedSlots.length} planned figure slots.`,
      );
    }
  } else if (
    blockPayload.figureRequests.length > 0 &&
    input.plan.figurePlanningCompleted
  ) {
    throw new DocumentPlanInvariantError(
      `Component "${input.component.componentKey}" cannot add unplanned figures.`,
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
      const requestId = draft.slotId
        ? stableFigureRequestId(draft.slotId, 0)
        : stableFigureRequestId(input.component.componentKey, index);
      return FigureRequestSchema.parse({
        ...draft,
        requestId,
        componentKey: input.component.componentKey,
        documentLanguage: input.documentLanguage,
        renderStrategy: resolveFigureRenderStrategy(draft.figureType),
        labels: createFigureLabelSpecs({
          requestId,
          claimsRepresented: draft.claimsRepresented,
        }),
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
        void _figureRequestIndexes;
        const blockId = `${input.component.componentKey}-${index + 1}`;
        const duplicateCountByFingerprint = new Map<string, number>();
        return {
          ...paragraph,
          id: blockId,
          segments:
            paragraph.citationGranularity === "segment"
              ? paragraph.segments.map((segment, segmentIndex) => {
                  const fingerprint = createHash("sha256")
                    .update(segment.text)
                    .update("\0")
                    .update(segment.citationIds.join("\0"))
                    .digest("hex");
                  const duplicateOrdinal =
                    duplicateCountByFingerprint.get(fingerprint) ?? 0;
                  duplicateCountByFingerprint.set(
                    fingerprint,
                    duplicateOrdinal + 1,
                  );
                  return {
                    segmentId: stableCitationSegmentId({
                      blockId,
                      text: segment.text,
                      citationIds: segment.citationIds,
                      duplicateOrdinal,
                    }),
                    order: segmentIndex,
                    text: segment.text,
                    citationIds: segment.citationIds,
                  };
                })
              : [],
          figureAssetIds: [],
        };
      }),
      assets: [],
    },
    figureRequests,
    paragraphFigureRefs,
  };
}

function stableCitationSegmentId(input: {
  blockId: string;
  text: string;
  citationIds: ReadonlyArray<string>;
  duplicateOrdinal: number;
}): string {
  const digest = createHash("sha256")
    .update(input.blockId)
    .update("\0")
    .update(input.text)
    .update("\0")
    .update(input.citationIds.join("\0"))
    .update("\0")
    .update(String(input.duplicateOrdinal))
    .digest("hex")
    .slice(0, 24);
  return `citation-segment-${digest}`;
}

function stableFigureRequestId(componentKey: string, index: number): string {
  const digest = createHash("sha256")
    .update(`${componentKey}:${index}`)
    .digest("hex")
    .slice(0, 24);
  return `figure-${digest}`;
}

function enqueueFigureRequests(
  state: DocumentOrchestrationState,
  requests: FigureRequest[],
  paragraphFigureRefs: Array<{
    blockIndex: number;
    requestIndexes: number[];
  }>,
): void {
  const existingIds = new Set(state.figures.map((figure) => figure.request.requestId));
  for (const [requestIndex, request] of requests.entries()) {
    if (existingIds.has(request.requestId)) continue;
    const component = state.components.find(
      (item) => item.componentKey === request.componentKey,
    );
    if (!component?.approved || component.approved.kind !== "blocks") {
      throw new DocumentPlanInvariantError(
        `Figure component "${request.componentKey}" has no approved blocks.`,
      );
    }
    const approvedBlocks = component.approved.blocks;
    const placementBlock =
      approvedBlocks[request.placementAfterBlockIndex];
    if (!placementBlock) {
      throw new DocumentPlanInvariantError(
        `Figure "${request.requestId}" has no valid placement block.`,
      );
    }
    state.figures.push({
      request,
      status: "pending",
      attempts: 0,
      placementAfterBlockId: placementBlock.id,
      paragraphBlockIds: paragraphFigureRefs
        .filter((reference) => reference.requestIndexes.includes(requestIndex))
        .map((reference) => approvedBlocks[reference.blockIndex]?.id)
        .filter((blockId): blockId is string => Boolean(blockId)),
    });
    existingIds.add(request.requestId);
  }
}

function attachFigureAsset(
  state: DocumentOrchestrationState,
  request: FigureRequest,
  placementAfterBlockId: string,
  paragraphBlockIds: string[],
  asset: Awaited<ReturnType<FigureAssetMaterializer["materialize"]>>,
): void {
  const componentState = state.components.find(
    (component) => component.componentKey === request.componentKey,
  );
  if (!componentState?.approved || componentState.approved.kind !== "blocks") {
    throw new DocumentPlanInvariantError(
      `Figure component "${request.componentKey}" has no approved block content.`,
    );
  }
  const paragraphIds = new Set(paragraphBlockIds);
  const blocks = componentState.approved.blocks.map((block) =>
      block.type === "paragraph" && paragraphIds.has(block.id)
        ? {
            ...block,
            figureAssetIds: [...new Set([...block.figureAssetIds, asset.id])],
          }
        : block,
  );
  const placementIndex = blocks.findIndex(
    (block) => block.id === placementAfterBlockId,
  );
  if (placementIndex < 0) {
    throw new DocumentPlanInvariantError(
      `Figure placement block "${placementAfterBlockId}" is missing.`,
    );
  }
  const siblingAssetIds = new Set(
    state.figures
      .filter(
        (figure) =>
          figure.placementAfterBlockId === placementAfterBlockId &&
          figure.asset,
      )
      .map((figure) => figure.asset!.id),
  );
  let insertionIndex = placementIndex + 1;
  while (blocks[insertionIndex]?.type === "figure") {
    const sibling = blocks[insertionIndex];
    if (sibling.type !== "figure" || !siblingAssetIds.has(sibling.assetId)) {
      break;
    }
    insertionIndex += 1;
  }
  blocks.splice(insertionIndex, 0, {
    id: `${request.requestId}-block`,
    type: "figure",
    caption: request.caption,
    assetId: asset.id,
  });
  componentState.approved = {
    kind: "blocks",
    blocks,
    assets: [...componentState.approved.assets, asset],
  };
  const approvedRevision = componentState.revisions.find(
    (revision) => revision.status === "approved",
  );
  if (approvedRevision) {
    approvedRevision.content = componentState.approved;
    approvedRevision.outputHash = createHash("sha256")
      .update(JSON.stringify(componentState.approved))
      .digest("hex");
  }
}

function listApprovedComponents(
  state: DocumentOrchestrationState,
): Array<{ componentKey: string; content: ApprovedComponent }> {
  return state.components
    .flatMap((component) =>
      component.approved
        ? [{ componentKey: component.componentKey, content: component.approved }]
        : [],
    );
}

function nextRunnableComponentIndex(
  state: DocumentOrchestrationState,
): number | undefined {
  const approvedKeys = new Set(
    state.components
      .filter((component) => component.status === "approved")
      .map((component) => component.componentKey),
  );
  const index = state.plan.components.findIndex((component, componentIndex) => {
    const execution = state.components[componentIndex];
    return (
      execution.status !== "approved" &&
      execution.status !== "failed" &&
      component.dependsOnComponentKeys.every((key) => approvedKeys.has(key))
    );
  });
  return index >= 0 ? index : undefined;
}

function componentInputHash(
  state: DocumentOrchestrationState,
  componentIndex: number,
): {
  inputHash: string;
  dependencyVersions: Record<string, number>;
} {
  const component = state.plan.components[componentIndex];
  const dependencyVersions = Object.fromEntries(
    component.dependsOnComponentKeys.map((key) => {
      const dependency = state.components.find((item) => item.componentKey === key);
      const current = dependency?.revisions.find((revision) => revision.status === "approved");
      return [key, current?.revision ?? 1];
    }),
  );
  return {
    dependencyVersions,
    inputHash: createHash("sha256")
      .update(
        JSON.stringify({
          request: state.request,
          reviewContract: {
            reviewThesis: state.plan.reviewThesis,
            scopeBoundary: state.plan.scopeBoundary,
            reviewQuestions: state.plan.reviewQuestions,
          },
          component,
          dependencyVersions,
          evidence: state.evidenceBundle
            .filter((item) =>
              (component.requiredEvidenceIds ?? []).includes(item.evidenceId),
            )
            .map((item) => ({
              evidenceId: item.evidenceId,
              excerptHash: createHash("sha256")
                .update(item.excerpt)
                .digest("hex"),
              locator: item.locator,
            }))
            .sort((left, right) =>
              left.evidenceId.localeCompare(right.evidenceId),
            ),
        }),
      )
      .digest("hex"),
  };
}

export function invalidateDocumentComponent(
  inputState: DocumentOrchestrationState,
  componentKey: string,
): DocumentOrchestrationState {
  const state = DocumentOrchestrationStateSchema.parse(structuredClone(inputState));
  const invalidated = new Set([componentKey]);
  let changed = true;
  while (changed) {
    changed = false;
    state.plan.components.forEach((component) => {
      if (
        !invalidated.has(component.componentKey) &&
        component.dependsOnComponentKeys.some((dependency) => invalidated.has(dependency))
      ) {
        invalidated.add(component.componentKey);
        changed = true;
      }
    });
  }
  for (const component of state.components) {
    if (!invalidated.has(component.componentKey)) continue;
    component.revisions = component.revisions.map((revision) => ({
      ...revision,
      status: "superseded" as const,
    }));
    component.approved = undefined;
    component.lastError = undefined;
    component.attempts = 0;
    component.transientFailures = 0;
    component.status =
      component.componentKey === componentKey ? "pending" : "stale";
  }
  state.figures = state.figures.filter(
    (figure) => !invalidated.has(figure.request.componentKey),
  );
  state.status = "paused";
  state.finalSpec = undefined;
  state.failure = undefined;
  state.currentComponentIndex =
    nextRunnableComponentIndex(state) ?? state.plan.components.length;
  return DocumentOrchestrationStateSchema.parse(state);
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

function isTransientGenerationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & {
    status?: number;
    code?: string;
  };
  if (
    candidate.status === 408 ||
    candidate.status === 409 ||
    candidate.status === 429 ||
    (candidate.status !== undefined && candidate.status >= 500)
  ) {
    return true;
  }
  return /(?:request timed out|timeout|timed out|econnreset|etimedout|rate limit|temporarily unavailable|connection reset|bad gateway|service unavailable|gateway timeout)/i.test(
    `${candidate.code ?? ""} ${candidate.message}`,
  );
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
  const maxTransientFailures =
    options.maxTransientFailuresPerComponent ?? 2;
  if (
    !Number.isInteger(maxTransientFailures) ||
    maxTransientFailures < 1 ||
    maxTransientFailures > 10
  ) {
    throw new RangeError(
      "maxTransientFailuresPerComponent must be between 1 and 10.",
    );
  }
  const maxComponents = options.maxComponentsPerRun ?? Number.POSITIVE_INFINITY;
  if (
    maxComponents !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxComponents) || maxComponents < 1)
  ) {
    throw new RangeError("maxComponentsPerRun must be a positive integer.");
  }
  const maxFigureAssets =
    options.maxFigureAssetsPerDocument ?? Number.POSITIVE_INFINITY;
  if (
    maxFigureAssets !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(maxFigureAssets) || maxFigureAssets < 0)
  ) {
    throw new RangeError(
      "maxFigureAssetsPerDocument must be a non-negative integer.",
    );
  }
  const maxFigureAttempts = options.maxFigureAttempts ?? 1;
  if (
    !Number.isInteger(maxFigureAttempts) ||
    maxFigureAttempts < 1 ||
    maxFigureAttempts > 5
  ) {
    throw new RangeError("maxFigureAttempts must be between 1 and 5.");
  }

  if (state.events.length === 0) {
    appendEvent(state, { type: "job_started" });
  }
  state.status = "running";
  let approvedThisRun = 0;

  while (state.components.some((component) => component.status !== "approved")) {
    if (approvedThisRun >= maxComponents) {
      state.status = "paused";
      appendEvent(state, { type: "job_paused" });
      return DocumentOrchestrationStateSchema.parse(state);
    }

    const componentIndex = nextRunnableComponentIndex(state);
    if (componentIndex === undefined) {
      state.status = "failed";
      state.failure = {
        code: "component_dependency_deadlock",
        message: "No pending document component has satisfied dependencies.",
      };
      appendEvent(state, {
        type: "job_failed",
        code: state.failure.code,
        message: state.failure.message,
      });
      return DocumentOrchestrationStateSchema.parse(state);
    }
    state.currentComponentIndex = componentIndex;
    const component = state.plan.components[componentIndex];
    const componentState = state.components[componentIndex];
    const approvedComponents = listApprovedComponents(state);

    componentState.status = "running";
    const contentAttempt = componentState.attempts + 1;
    appendEvent(state, {
      type: "component_started",
      componentKey: component.componentKey,
      attempt: contentAttempt,
    });

    let payload: GeneratedComponentPayload;
    try {
      payload = GeneratedComponentPayloadSchema.parse(
        await options.generator.generate({
          request: state.request,
          plan: state.plan,
          component,
          componentIndex,
          figureSlots: state.plan.figureSlots.filter(
            (slot) => slot.componentKey === component.componentKey,
          ),
          generationRevision: componentState.generationRevision,
          attempt: contentAttempt,
          repairFeedback:
            componentState.lastError &&
            componentState.lastError.code !== "component_generation_transient"
            ? {
                code: componentState.lastError.code,
                message: componentState.lastError.message,
              }
            : undefined,
          approvedComponents,
          verifiedReferences: state.verifiedReferences,
          evidenceBundle: state.evidenceBundle,
        }),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown generation failure.";
      if (isTransientGenerationFailure(error)) {
        componentState.transientFailures += 1;
        componentState.lastError = {
          code: "component_generation_transient",
          message,
        };
        appendEvent(state, {
          type: "component_rejected",
          componentKey: component.componentKey,
          attempt: contentAttempt,
          code: componentState.lastError.code,
          message,
        });
        if (componentState.transientFailures >= maxTransientFailures) {
          const terminalCode = /timed out|timeout/i.test(message)
            ? "component_generation_timeout"
            : "component_generation_unavailable";
          failJob(
            state,
            componentState,
            terminalCode,
            message,
          );
          return DocumentOrchestrationStateSchema.parse(state);
        }
        continue;
      }
      componentState.attempts = contentAttempt;
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
    componentState.attempts = contentAttempt;
    const normalization = normalizeGeneratedComponentContent(payload);
    payload = normalization.payload;
    componentState.normalizationRecords = [
      ...componentState.normalizationRecords,
      ...normalization.records.map((record) => ({
        ...record,
        generationRevision: componentState.generationRevision,
        attempt: contentAttempt,
      })),
    ].slice(-2_000);
    const normalizationIssue = normalization.issues[0];
    if (normalizationIssue) {
      componentState.lastError = {
        code: normalizationIssue.code,
        message: `${normalizationIssue.message} Field: ${normalizationIssue.fieldPath}.`,
      };
      appendEvent(state, {
        type: "component_rejected",
        componentKey: component.componentKey,
        attempt: componentState.attempts,
        code: componentState.lastError.code,
        message: componentState.lastError.message,
      });
      if (componentState.attempts >= maxAttempts) {
        failJob(
          state,
          componentState,
          componentState.lastError.code,
          componentState.lastError.message,
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
        plan: state.plan,
        documentLanguage: state.request.language,
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

    const approved = structuralApproval.approved;
    const remainingFigureCapacity = Math.max(
      0,
      maxFigureAssets - state.figures.length,
    );
    if (structuralApproval.figureRequests.length > remainingFigureCapacity) {
      componentState.lastError = {
        code: "figure_budget_exceeded",
        message: `Component requested ${structuralApproval.figureRequests.length} figures but only ${remainingFigureCapacity} planned figure slots remain.`,
      };
      appendEvent(state, {
        type: "component_rejected",
        componentKey: component.componentKey,
        attempt: componentState.attempts,
        code: componentState.lastError.code,
        message: componentState.lastError.message,
      });
      if (componentState.attempts >= maxAttempts) {
        failJob(
          state,
          componentState,
          componentState.lastError.code,
          componentState.lastError.message,
        );
        return DocumentOrchestrationStateSchema.parse(state);
      }
      continue;
    }

    componentState.status = "approved";
    componentState.approved = approved;
    const { inputHash, dependencyVersions } = componentInputHash(
      state,
      componentIndex,
    );
    componentState.revisions = [
      ...componentState.revisions.map((revision) => ({
        ...revision,
        status: "superseded" as const,
      })),
      {
        revision:
          Math.max(0, ...componentState.revisions.map((revision) => revision.revision)) + 1,
        status: "approved",
        content: approved,
        dependencyVersions,
        inputHash,
        outputHash: createHash("sha256")
          .update(JSON.stringify(approved))
          .digest("hex"),
      },
    ];
    componentState.lastError = undefined;
    enqueueFigureRequests(
      state,
      structuralApproval.figureRequests,
      structuralApproval.paragraphFigureRefs,
    );
    appendEvent(state, {
      type: "component_approved",
      componentKey: component.componentKey,
      attempt: componentState.attempts,
    });
    state.currentComponentIndex =
      nextRunnableComponentIndex(state) ?? state.plan.components.length;
    approvedThisRun += 1;
    if (approvedThisRun >= maxComponents) {
      state.status = "paused";
      appendEvent(state, { type: "job_paused" });
      return DocumentOrchestrationStateSchema.parse(state);
    }
  }

  const pendingFigure = state.figures.find(
    (figure) => figure.status !== "approved" && figure.status !== "failed",
  );
  if (pendingFigure) {
    if (!options.figureAssetMaterializer) {
      state.status = "failed";
      state.failure = {
        code: "figure_asset_materializer_missing",
        message: "Planned figures require a configured figure asset materializer.",
        componentKey: pendingFigure.request.componentKey,
      };
      appendEvent(state, {
        type: "job_failed",
        componentKey: pendingFigure.request.componentKey,
        code: state.failure.code,
        message: state.failure.message,
      });
      return DocumentOrchestrationStateSchema.parse(state);
    }
    pendingFigure.status = "running";
    pendingFigure.attempts += 1;
    appendEvent(state, {
      type: "figure_started",
      componentKey: pendingFigure.request.componentKey,
      attempt: pendingFigure.attempts,
      message: pendingFigure.request.title,
    });
    try {
      const asset = await options.figureAssetMaterializer.materialize(
        pendingFigure.request,
        { onProviderCall: options.onFigureProviderCall },
      );
      if (asset.requestId !== pendingFigure.request.requestId) {
        throw new DocumentPlanInvariantError(
          `Figure asset request ID "${asset.requestId}" does not match "${pendingFigure.request.requestId}".`,
        );
      }
      attachFigureAsset(
        state,
        pendingFigure.request,
        pendingFigure.placementAfterBlockId,
        pendingFigure.paragraphBlockIds,
        asset,
      );
      pendingFigure.status = "approved";
      pendingFigure.asset = asset;
      pendingFigure.lastError = undefined;
      appendEvent(state, {
        type: "figure_approved",
        componentKey: pendingFigure.request.componentKey,
        attempt: pendingFigure.attempts,
        message: pendingFigure.request.title,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Figure asset generation failed.";
      pendingFigure.lastError = {
        code: "figure_asset_generation_failed",
        message,
      };
      appendEvent(state, {
        type: "figure_rejected",
        componentKey: pendingFigure.request.componentKey,
        attempt: pendingFigure.attempts,
        code: pendingFigure.lastError.code,
        message,
      });
      if (pendingFigure.attempts >= maxFigureAttempts) {
        pendingFigure.status = "failed";
        state.status = "failed";
        state.failure = {
          code: pendingFigure.lastError.code,
          message,
          componentKey: pendingFigure.request.componentKey,
        };
        appendEvent(state, {
          type: "job_failed",
          componentKey: pendingFigure.request.componentKey,
          attempt: pendingFigure.attempts,
          code: state.failure.code,
          message,
        });
        return DocumentOrchestrationStateSchema.parse(state);
      }
      pendingFigure.status = "pending";
    }
    state.status = "paused";
    appendEvent(state, { type: "job_paused" });
    return DocumentOrchestrationStateSchema.parse(state);
  }

  if (state.figures.some((figure) => figure.status === "failed")) {
    state.status = "failed";
    return DocumentOrchestrationStateSchema.parse(state);
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
