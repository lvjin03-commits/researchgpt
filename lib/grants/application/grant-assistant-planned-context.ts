import { GrantAssistantContextPlanSchema, type GrantAssistantContextPlan } from "../assistant/context-plan-contracts.ts";
import { GrantDocumentMemorySnapshotSchema, type GrantDocumentMemorySnapshot } from "../assistant/document-memory-contracts.ts";
import { GrantAssistantPlannedContextSchema, type GrantAssistantPlannedContext } from "../assistant/planned-context-contracts.ts";
import { GrantNormalizedFindingSchema, type GrantNormalizedFinding } from "../diagnostics/normalized-finding.ts";
import { grantNodeText } from "../diagnostics/node-text.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { CanonicalGrantSnapshotSchema, type CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantDiagnosticRepository } from "../ports/grant-diagnostic-repository.ts";
import { buildGrantAssistantAnswerMemoryProjection } from "./grant-document-memory-projection.ts";
import { createGrantAssistantFailureReason, type GrantAssistantFailureReason,
  type GrantAssistantFailureReasonCode } from "../model-execution/assistant-failure-reasons.ts";

export class GrantAssistantPlannedContextError extends Error {
  readonly code: "stale_plan" | "stale_memory" | "invalid_target" | "diagnostics_unavailable" |
    "invalid_diagnostic_anchor";
  readonly failureStage = "original_retrieval" as const;
  readonly failureReason: GrantAssistantFailureReason;
  readonly requestDispatched = false;
  readonly usageKnown = true;
  readonly usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  constructor(code: GrantAssistantPlannedContextError["code"], reasonCode: GrantAssistantFailureReasonCode,
    message: string) {
    super(message);
    this.name = "GrantAssistantPlannedContextError";
    this.code = code;
    this.failureReason = createGrantAssistantFailureReason({ reasonCode, stage: "original_retrieval",
      safeFacts: { requestDispatched: false, usageKnown: true } });
  }
}
function descendantSectionIds(snapshot: CanonicalGrantSnapshot, requested: ReadonlySet<string>) {
  const included = new Set(requested);
  let changed = true;
  while (changed) {
    changed = false;
    for (const section of snapshot.sections) {
      if (section.parentSectionId && included.has(section.parentSectionId) && !included.has(section.sectionId)) {
        included.add(section.sectionId);
        changed = true;
      }
    }
  }
  return included;
}

function findingLocations(finding: GrantNormalizedFinding) {
  return [
    ...(finding.sourceAnchor.sectionId && finding.sourceAnchor.nodeId
      ? [{ sectionId: finding.sourceAnchor.sectionId, nodeId: finding.sourceAnchor.nodeId }] : []),
    ...finding.relatedLocations.map(({ sectionId, nodeId }) => ({ sectionId, nodeId })),
    ...finding.rootOccurrences.flatMap((occurrence) => [occurrence.primaryLocation,
      ...occurrence.relatedLocations.map(({ sectionId, nodeId }) => ({ sectionId, nodeId }))]),
  ];
}

function validateFindingAnchors(finding: GrantNormalizedFinding, snapshot: CanonicalGrantSnapshot) {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
  for (const location of findingLocations(finding)) {
    if (nodeById.get(location.nodeId)?.sectionId !== location.sectionId) {
      throw new GrantAssistantPlannedContextError("invalid_diagnostic_anchor", "context.diagnostic_anchor_invalid",
        "A current diagnostic Finding points outside the canonical Revision.");
    }
  }
}

function diagnosticExcerpt(finding: GrantNormalizedFinding) {
  return [
    `诊断事实：${finding.diagnosticFact}`,
    finding.reason ? `原因：${finding.reason}` : "",
    `建议：${finding.recommendation}`,
    finding.possibleConsequence ? `可能后果：${finding.possibleConsequence}` : "",
    `判断范围：${finding.assessment.scope}；置信度：${finding.assessment.confidence}`,
  ].filter(Boolean).join("\n");
}

export async function assembleGrantAssistantPlannedContext(input: {
  documentId: string;
  sourceRevisionId: string;
  snapshot: CanonicalGrantSnapshot;
  memory: GrantDocumentMemorySnapshot;
  plan: GrantAssistantContextPlan;
  diagnostics: Pick<GrantDiagnosticRepository, "listNormalizedFindings">;
}): Promise<GrantAssistantPlannedContext> {
  const snapshotResult = CanonicalGrantSnapshotSchema.safeParse(input.snapshot);
  if (!snapshotResult.success) throw new GrantAssistantPlannedContextError("stale_plan",
    "context.snapshot_contract_invalid", "The canonical Revision snapshot is invalid.");
  const snapshot = snapshotResult.data;
  const memoryResult = GrantDocumentMemorySnapshotSchema.safeParse(input.memory);
  if (!memoryResult.success) throw new GrantAssistantPlannedContextError("stale_memory",
    "context.stale_memory", "The document memory contract is invalid.");
  const memory = memoryResult.data;
  const planResult = GrantAssistantContextPlanSchema.safeParse(input.plan);
  if (!planResult.success) throw new GrantAssistantPlannedContextError("stale_plan",
    "context.stale_plan", "The context plan contract is invalid.");
  const plan = planResult.data;
  if (plan.documentId !== input.documentId || plan.sourceRevisionId !== input.sourceRevisionId
    || plan.memoryId !== memory.memoryId || plan.memoryHash !== memory.memoryHash) {
    throw new GrantAssistantPlannedContextError("stale_plan", "context.stale_plan",
      "The context plan does not belong to the current document memory and Revision.");
  }
  if (memory.documentId !== input.documentId || memory.sourceRevisionId !== input.sourceRevisionId) {
    throw new GrantAssistantPlannedContextError("stale_memory", "context.stale_memory",
      "The document memory does not belong to the current canonical Revision.");
  }
  const sectionById = new Map(snapshot.sections.map((section) => [section.sectionId, section]));
  const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
  const memoryItemById = new Map(memory.l1.items.map((item) => [item.memoryItemId, item]));
  const sectionAnchorById = new Map(memory.l2.sectionAnchors.map((anchor) => [anchor.sectionId, anchor]));
  const itemAnchorById = new Map(memory.l2.itemAnchors.map((anchor) => [anchor.memoryItemId, anchor]));
  for (const anchor of memory.l2.sectionAnchors) {
    const admittedSectionIds = descendantSectionIds(snapshot, new Set([anchor.sectionId]));
    if (anchor.sourceNodeIds.some((nodeId) => {
      const sectionId = nodeById.get(nodeId)?.sectionId;
      return !sectionId || !admittedSectionIds.has(sectionId);
    })) {
      throw new GrantAssistantPlannedContextError("stale_memory", "context.section_anchor_outside_subtree",
        "L2 section references do not resolve inside the declared section subtree of the current canonical Revision.");
    }
  }
  for (const anchor of memory.l2.itemAnchors) {
    const item = memoryItemById.get(anchor.memoryItemId);
    if (!item) throw new GrantAssistantPlannedContextError("stale_memory",
      "context.item_anchor_outside_section", "L2 item references do not resolve to an L1 memory item.");
    if (anchor.sourceNodeIds.some((nodeId) => {
      const sectionId = nodeById.get(nodeId)?.sectionId;
      return !sectionId || !item.sourceSectionIds.includes(sectionId);
    })) {
      throw new GrantAssistantPlannedContextError("stale_memory", "context.item_anchor_outside_section",
        "L2 item references do not resolve inside their declared L1 sections.");
    }
  }
  if (plan.targetSectionIds.some((sectionId) => !sectionById.has(sectionId))
    || plan.targetMemoryItemIds.some((itemId) => !memoryItemById.has(itemId))) {
    throw new GrantAssistantPlannedContextError("invalid_target", "context.target_unavailable",
      "The plan selected content outside the current Revision memory.");
  }

  const memoryExcerpt = buildGrantAssistantAnswerMemoryProjection({ memory, answerMode: plan.answerMode,
    targetSectionIds: plan.targetSectionIds, targetMemoryItemIds: plan.targetMemoryItemIds });
  const sources: GrantAssistantPlannedContext["sources"] = [{ sourceAlias: "MEMORY1",
    sourceType: "document_memory", label: "当前申请书分层记忆", excerpt: memoryExcerpt,
    memoryId: memory.memoryId }];
  const requestedSectionIds = new Set(plan.targetSectionIds);
  const requestedNodeIds = new Set<string>();
  for (const itemId of plan.targetMemoryItemIds) {
    const item = memoryItemById.get(itemId)!;
    item.sourceSectionIds.forEach((sectionId) => requestedSectionIds.add(sectionId));
    const itemAnchor = itemAnchorById.get(itemId);
    if (!itemAnchor) throw new GrantAssistantPlannedContextError("stale_memory",
      "context.item_anchor_outside_section", "The selected memory item has no current L2 source anchor.");
    itemAnchor.sourceNodeIds.forEach((nodeId) => requestedNodeIds.add(nodeId));
  }
  const admittedSectionIds = plan.documentAccess === "full_original"
    ? new Set(snapshot.sections.map((section) => section.sectionId))
    : descendantSectionIds(snapshot, requestedSectionIds);
  if (plan.documentAccess !== "memory_only") {
    admittedSectionIds.forEach((sectionId) => sectionAnchorById.get(sectionId)?.sourceNodeIds
      .forEach((nodeId) => requestedNodeIds.add(nodeId)));
  }
  const admittedNodeIds = plan.documentAccess === "memory_only" ? new Set<string>()
    : plan.documentAccess === "full_original" ? new Set(snapshot.nodes.map((node) => node.nodeId)) : requestedNodeIds;

  // Full-original plans report deterministic complete coverage here, but do
  // not materialize the whole document into one answer request. The memory
  // pipeline owns hierarchical original-text reading for that mode.
  if (plan.documentAccess === "targeted_original") {
    snapshot.nodes.filter((node) => admittedNodeIds.has(node.nodeId))
      .sort((left, right) => {
        const leftSection = snapshot.sections.findIndex((section) => section.sectionId === left.sectionId);
        const rightSection = snapshot.sections.findIndex((section) => section.sectionId === right.sectionId);
        return leftSection - rightSection || left.order - right.order;
      }).forEach((node, index) => sources.push({ sourceAlias: `O${index + 1}`, sourceType: "original_text",
        label: `${sectionById.get(node.sectionId)!.title} / 原文`, excerpt: grantNodeText(node),
        sectionId: node.sectionId, nodeId: node.nodeId }));
  }

  let currentFindings: GrantNormalizedFinding[] = [];
  if (plan.diagnosticAccess !== "none") {
    if (!input.diagnostics.listNormalizedFindings) throw new GrantAssistantPlannedContextError(
      "diagnostics_unavailable", "context.diagnostics_unavailable",
      "Current normalized diagnostic Findings are unavailable.");
    let storedFindings: Awaited<ReturnType<NonNullable<typeof input.diagnostics.listNormalizedFindings>>>;
    try {
      storedFindings = await input.diagnostics.listNormalizedFindings(input.documentId);
    } catch {
      throw new GrantAssistantPlannedContextError("diagnostics_unavailable", "context.diagnostics_unavailable",
        "Current normalized diagnostic Findings could not be loaded.");
    }
    currentFindings = storedFindings.map((finding) => {
      const parsed = GrantNormalizedFindingSchema.safeParse(finding);
      if (!parsed.success) throw new GrantAssistantPlannedContextError("diagnostics_unavailable",
        "context.diagnostic_contract_invalid", "A current diagnostic Finding violates its stored contract.");
      return parsed.data;
    }).filter((finding) => finding.sourceRevisionId === input.sourceRevisionId && finding.lifecycleStatus === "open");
    currentFindings.forEach((finding) => validateFindingAnchors(finding, snapshot));
  }
  const relevantSectionIds = descendantSectionIds(snapshot, requestedSectionIds);
  const relevantNodeIds = new Set(requestedNodeIds);
  const admittedFindings = plan.diagnosticAccess === "all" ? currentFindings
    : plan.diagnosticAccess === "relevant" ? currentFindings.filter((finding) => findingLocations(finding)
      .some((location) => relevantSectionIds.has(location.sectionId) || relevantNodeIds.has(location.nodeId))) : [];
  admittedFindings.forEach((finding, index) => sources.push({ sourceAlias: `G${index + 1}`,
    sourceType: "diagnostic", label: finding.title ?? finding.category, excerpt: diagnosticExcerpt(finding),
    findingId: finding.findingId, ...(finding.sourceAnchor.sectionId ? { sectionId: finding.sourceAnchor.sectionId } : {}),
    ...(finding.sourceAnchor.nodeId ? { nodeId: finding.sourceAnchor.nodeId } : {}) }));

  const coveredSectionIds = new Set([...admittedNodeIds].map((nodeId) => nodeById.get(nodeId)!.sectionId));
  const contextContent = { planHash: plan.planHash, memoryHash: memory.memoryHash,
    sources: sources.map(({ sourceAlias, sourceType, label, excerpt, sectionId, nodeId, findingId, memoryId }) =>
      ({ sourceAlias, sourceType, label, excerpt, sectionId, nodeId, findingId, memoryId })) };
  const result = GrantAssistantPlannedContextSchema.safeParse({ schemaVersion: "grant-assistant-planned-context-v1",
    documentId: input.documentId, sourceRevisionId: input.sourceRevisionId, planId: plan.planId,
    planHash: plan.planHash, memoryId: memory.memoryId, memoryHash: memory.memoryHash,
    contextHash: sha256Canonical(contextContent), sources,
    coverage: { memoryIncluded: true, originalMode: plan.documentAccess,
      totalSectionCount: snapshot.sections.length, coveredSectionCount: coveredSectionIds.size,
      totalNodeCount: snapshot.nodes.length, coveredNodeCount: admittedNodeIds.size,
      completeOriginal: admittedNodeIds.size === snapshot.nodes.length,
      diagnosticMode: plan.diagnosticAccess, availableCurrentFindingCount: currentFindings.length,
      admittedFindingCount: admittedFindings.length } });
  if (!result.success) throw new GrantAssistantPlannedContextError("stale_plan",
    "context.output_contract_invalid", "The assembled Grant Assistant context is invalid.");
  return result.data;
}
