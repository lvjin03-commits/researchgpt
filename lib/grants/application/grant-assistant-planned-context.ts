import { GrantAssistantContextPlanSchema, type GrantAssistantContextPlan } from "../assistant/context-plan-contracts.ts";
import { GrantDocumentMemorySnapshotSchema, type GrantDocumentMemorySnapshot } from "../assistant/document-memory-contracts.ts";
import { GrantAssistantPlannedContextSchema, type GrantAssistantPlannedContext } from "../assistant/planned-context-contracts.ts";
import { GrantNormalizedFindingSchema, type GrantNormalizedFinding } from "../diagnostics/normalized-finding.ts";
import { grantNodeText } from "../diagnostics/node-text.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { CanonicalGrantSnapshotSchema, type CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantDiagnosticRepository } from "../ports/grant-diagnostic-repository.ts";
import { buildGrantAssistantPlanningProjection } from "./grant-assistant-context-planner.ts";
import { buildGrantFullDocumentContext } from "./grant-full-document-context.ts";

export class GrantAssistantPlannedContextError extends Error {
  readonly code: "stale_plan" | "stale_memory" | "invalid_target" | "diagnostics_unavailable" |
    "invalid_diagnostic_anchor";
  constructor(code: GrantAssistantPlannedContextError["code"], message: string) {
    super(message);
    this.name = "GrantAssistantPlannedContextError";
    this.code = code;
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
      throw new GrantAssistantPlannedContextError("invalid_diagnostic_anchor",
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
  const snapshot = CanonicalGrantSnapshotSchema.parse(input.snapshot);
  const memory = GrantDocumentMemorySnapshotSchema.parse(input.memory);
  const plan = GrantAssistantContextPlanSchema.parse(input.plan);
  if (plan.documentId !== input.documentId || plan.sourceRevisionId !== input.sourceRevisionId
    || plan.memoryId !== memory.memoryId || plan.memoryHash !== memory.memoryHash) {
    throw new GrantAssistantPlannedContextError("stale_plan",
      "The context plan does not belong to the current document memory and Revision.");
  }
  if (memory.documentId !== input.documentId || memory.sourceRevisionId !== input.sourceRevisionId) {
    throw new GrantAssistantPlannedContextError("stale_memory",
      "The document memory does not belong to the current canonical Revision.");
  }
  const sectionById = new Map(snapshot.sections.map((section) => [section.sectionId, section]));
  const nodeById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
  const memoryItemById = new Map(memory.items.map((item) => [item.memoryItemId, item]));
  if (plan.targetSectionIds.some((sectionId) => !sectionById.has(sectionId))
    || plan.targetMemoryItemIds.some((itemId) => !memoryItemById.has(itemId))) {
    throw new GrantAssistantPlannedContextError("invalid_target", "The plan selected content outside the current Revision memory.");
  }

  const projection = buildGrantAssistantPlanningProjection(memory);
  const sources: GrantAssistantPlannedContext["sources"] = [{ sourceAlias: "MEMORY1",
    sourceType: "document_memory", label: "当前申请书全文记忆", excerpt: projection.modelText,
    memoryId: memory.memoryId }];
  const requestedSectionIds = new Set(plan.targetSectionIds);
  const requestedNodeIds = new Set<string>();
  for (const itemId of plan.targetMemoryItemIds) {
    const item = memoryItemById.get(itemId)!;
    item.sourceSectionIds.forEach((sectionId) => requestedSectionIds.add(sectionId));
    item.sourceNodeIds.forEach((nodeId) => requestedNodeIds.add(nodeId));
  }
  const admittedSectionIds = plan.documentAccess === "full_original"
    ? new Set(snapshot.sections.map((section) => section.sectionId))
    : descendantSectionIds(snapshot, requestedSectionIds);
  if (plan.documentAccess !== "memory_only") {
    snapshot.nodes.filter((node) => admittedSectionIds.has(node.sectionId)).forEach((node) => requestedNodeIds.add(node.nodeId));
  }
  const admittedNodeIds = plan.documentAccess === "memory_only" ? new Set<string>()
    : plan.documentAccess === "full_original" ? new Set(snapshot.nodes.map((node) => node.nodeId)) : requestedNodeIds;

  if (plan.documentAccess === "full_original") {
    const full = buildGrantFullDocumentContext({ documentId: input.documentId,
      sourceRevisionId: input.sourceRevisionId, snapshot });
    full.nodes.forEach((node, index) => {
      const section = full.sections.find((candidate) => candidate.sectionAlias === node.sectionAlias)!;
      sources.push({ sourceAlias: `O${index + 1}`, sourceType: "original_text",
        label: `${section.title} / 原文`, excerpt: node.text, sectionId: section.sectionId, nodeId: node.nodeId });
    });
  } else if (plan.documentAccess === "targeted_original") {
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
      "diagnostics_unavailable", "Current normalized diagnostic Findings are unavailable.");
    currentFindings = (await input.diagnostics.listNormalizedFindings(input.documentId))
      .map((finding) => GrantNormalizedFindingSchema.parse(finding))
      .filter((finding) => finding.sourceRevisionId === input.sourceRevisionId && finding.lifecycleStatus === "open");
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
  return GrantAssistantPlannedContextSchema.parse({ schemaVersion: "grant-assistant-planned-context-v1",
    documentId: input.documentId, sourceRevisionId: input.sourceRevisionId, planId: plan.planId,
    planHash: plan.planHash, memoryId: memory.memoryId, memoryHash: memory.memoryHash,
    contextHash: sha256Canonical(contextContent), sources,
    coverage: { memoryIncluded: true, originalMode: plan.documentAccess,
      totalSectionCount: snapshot.sections.length, coveredSectionCount: coveredSectionIds.size,
      totalNodeCount: snapshot.nodes.length, coveredNodeCount: admittedNodeIds.size,
      completeOriginal: admittedNodeIds.size === snapshot.nodes.length,
      diagnosticMode: plan.diagnosticAccess, availableCurrentFindingCount: currentFindings.length,
      admittedFindingCount: admittedFindings.length } });
}
