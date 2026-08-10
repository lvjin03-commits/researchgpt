import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantFinding } from "../diagnostics/contracts.ts";
import type { GrantPatchModel, GrantPatchModelResult } from "../ports/grant-patch-model.ts";
import type { GrantDiagnosticModel, GrantDiagnosticModelResult, GrantSemanticDiagnosticV3ModelResult } from "../ports/grant-diagnostic-model.ts";
import { grantEditableNodeText } from "../patching/patch-policy.ts";
import type { GrantPatchEvidenceBinding } from "../patching/contracts.ts";
import { GrantEvidenceAuthorizationService } from "./evidence-authorization-service.ts";
import { selectGrantEvidenceCards } from "./grant-evidence-selector.ts";
import { grantNodeText } from "../diagnostics/node-text.ts";
import {
  buildGrantSemanticDiagnosticV3Input,
  type GrantSemanticDiagnosticV3PreparedInput,
  type GrantSemanticDiagnosticV3PriorFinding,
} from "../diagnostics/semantic-v3-input.ts";
import { buildGrantHierarchicalDiagnosticPreparedInputV1 } from "../diagnostics/hierarchical-semantic-input.ts";
import type { GrantArgumentMapV1 } from "../diagnostics/hierarchical-semantic-contracts.ts";

export class GrantEvidenceProviderPolicyError extends Error {}
export class GrantPatchEvidenceMismatchError extends Error {}

export type GrantModelPatchResult = GrantPatchModelResult & {
  evidenceBindings: GrantPatchEvidenceBinding[];
};

export class GrantModelDataGateway {
  private readonly model: GrantPatchModel & Partial<GrantDiagnosticModel>;
  private readonly evidenceAuthorization?: GrantEvidenceAuthorizationService;

  constructor(model: GrantPatchModel & Partial<GrantDiagnosticModel>, evidenceAuthorization?: GrantEvidenceAuthorizationService) {
    this.model = model;
    this.evidenceAuthorization = evidenceAuthorization;
  }

  async prepareDiagnosticV3Input(input: {
    documentId: string;
    taskId: string;
    snapshot: CanonicalGrantSnapshot;
    inputMode: "full_document" | "section_bundle" | "focused_excerpt";
    inputSectionIds: string[];
    inputNodeIds: string[];
    fundingCategory: string;
    priorFindings: GrantSemanticDiagnosticV3PriorFinding[];
  }): Promise<GrantSemanticDiagnosticV3PreparedInput> {
    const sectionIds = new Set(input.inputSectionIds);
    const nodeIds = new Set(input.inputNodeIds);
    const queryText = [
      input.snapshot.title,
      ...input.snapshot.sections
        .filter((section) => sectionIds.has(section.sectionId))
        .flatMap((section) => [
          section.title,
          ...input.snapshot.nodes
            .filter((node) => node.sectionId === section.sectionId && nodeIds.has(node.nodeId))
            .map(grantNodeText),
        ]),
    ].join("\n");
    const resources = this.evidenceAuthorization
      ? await this.evidenceAuthorization.listCurrentForModelReasoning({ documentId: input.documentId, taskId: input.taskId })
      : [];
    const selected = selectGrantEvidenceCards(resources, queryText);

    return buildGrantSemanticDiagnosticV3Input({
      snapshot: input.snapshot,
      inputMode: input.inputMode,
      inputSectionIds: input.inputSectionIds,
      inputNodeIds: input.inputNodeIds,
      fundingCategory: input.fundingCategory,
      evidenceCards: selected.map(({ resource, card }) => ({
        sourceId: resource.source.sourceId,
        cardId: card.cardId,
        sourceTitle: resource.source.title,
        provenanceType: resource.source.provenanceType,
        verificationStatus: "verified" as const,
        supportedScope: "Only the exact supplied excerpt is verified against the authorized uploaded source; claims outside it are not verified.",
        excerpt: card.excerpt,
        authorizationRevision: resource.authorization.revision,
        sourceContentHash: resource.source.contentHash,
        excerptHash: card.excerptHash,
      })),
      priorFindings: input.priorFindings,
    });
  }

  async diagnoseV3(input: {
    documentId: string;
    taskId: string;
    snapshot: CanonicalGrantSnapshot;
    inputMode: "full_document" | "section_bundle" | "focused_excerpt";
    inputSectionIds: string[];
    inputNodeIds: string[];
    fundingCategory: string;
    priorFindings: GrantSemanticDiagnosticV3PriorFinding[];
  }): Promise<{
    generated: GrantSemanticDiagnosticV3ModelResult;
    prepared: GrantSemanticDiagnosticV3PreparedInput;
  }> {
    if (!this.model.diagnoseV3) {
      throw new GrantEvidenceProviderPolicyError("Grant semantic diagnostic V3 is not configured.");
    }
    const prepared = await this.prepareDiagnosticV3Input(input);
    const generated = await this.model.diagnoseV3(prepared);
    return { generated, prepared };
  }

  async diagnoseHierarchical(input: {
    documentId: string;
    taskId: string;
    snapshot: CanonicalGrantSnapshot;
    inputMode: "full_document" | "section_bundle" | "focused_excerpt";
    inputSectionIds: string[];
    inputNodeIds: string[];
    fundingCategory: string;
    priorFindings: GrantSemanticDiagnosticV3PriorFinding[];
    sourceRevisionId: string;
    argumentMapCheckpoint?: GrantArgumentMapV1;
  }) {
    if (!this.model.diagnoseHierarchical) {
      throw new GrantEvidenceProviderPolicyError("Grant hierarchical semantic diagnosis is not configured.");
    }
    const prepared = await this.prepareDiagnosticHierarchicalInput(input);
    const generated = await this.model.diagnoseHierarchical(prepared, input.argumentMapCheckpoint);
    return { generated, prepared };
  }

  async prepareDiagnosticHierarchicalInput(input: {
    documentId: string;
    taskId: string;
    snapshot: CanonicalGrantSnapshot;
    inputMode: "full_document" | "section_bundle" | "focused_excerpt";
    inputSectionIds: string[];
    inputNodeIds: string[];
    fundingCategory: string;
    priorFindings: GrantSemanticDiagnosticV3PriorFinding[];
    sourceRevisionId: string;
  }) {
    const v3Prepared = await this.prepareDiagnosticV3Input(input);
    return buildGrantHierarchicalDiagnosticPreparedInputV1({
      sourceRevisionId: input.sourceRevisionId,
      prepared: v3Prepared,
    });
  }

  async executeDiagnosticHierarchicalInput(
    prepared: ReturnType<GrantModelDataGateway["prepareDiagnosticHierarchicalInput"]> extends Promise<infer T> ? T : never,
    argumentMapCheckpoint?: GrantArgumentMapV1,
  ) {
    if (!this.model.diagnoseHierarchical) {
      throw new GrantEvidenceProviderPolicyError("Grant hierarchical semantic diagnosis is not configured.");
    }
    return this.model.diagnoseHierarchical(prepared, argumentMapCheckpoint);
  }

  async diagnose(input: {
    documentId: string;
    taskId: string;
    snapshot: CanonicalGrantSnapshot;
    inputMode: "full_document" | "section_bundle" | "focused_excerpt";
    inputSectionIds: string[];
    inputNodeIds: string[];
  }): Promise<GrantDiagnosticModelResult & { authorizedEvidenceCardIds: string[] }> {
    const sectionIds = new Set(input.inputSectionIds);
    const nodeIds = new Set(input.inputNodeIds);
    const sections = input.snapshot.sections
      .filter((section) => sectionIds.has(section.sectionId))
      .map((section) => ({
        sectionId: section.sectionId,
        semanticRole: section.semanticRole,
        title: section.title,
        parentSectionId: section.parentSectionId,
        nodes: input.snapshot.nodes
          .filter((node) => node.sectionId === section.sectionId && nodeIds.has(node.nodeId))
          .sort((left, right) => left.order - right.order)
          .map((node) => ({
            nodeId: node.nodeId,
            sectionId: node.sectionId,
            nodeType: node.nodeType,
            text: grantNodeText(node),
          })),
      }));
    const queryText = [input.snapshot.title, ...sections.flatMap((section) => [section.title, ...section.nodes.map((node) => node.text)])].join("\n");
    const resources = this.evidenceAuthorization
      ? await this.evidenceAuthorization.listCurrentForModelReasoning({ documentId: input.documentId, taskId: input.taskId })
      : [];
    const selected = selectGrantEvidenceCards(resources, queryText);
    if (!this.model.diagnose) throw new GrantEvidenceProviderPolicyError("Grant semantic diagnostics are not configured.");
    const generated = await this.model.diagnose({
      documentLanguage: /[\u3400-\u9fff]/u.test(queryText) ? "zh" : "en",
      documentTitle: input.snapshot.title,
      inputMode: input.inputMode,
      sections,
      evidence: selected.map(({ resource, card }) => ({
        sourceId: resource.source.sourceId,
        cardId: card.cardId,
        sourceTitle: resource.source.title,
        provenanceType: resource.source.provenanceType,
        excerpt: card.excerpt,
      })),
    });
    const allowedSectionIds = new Set(sections.map((section) => section.sectionId));
    const allowedNodeIds = new Set(sections.flatMap((section) => section.nodes.map((node) => node.nodeId)));
    for (const finding of generated.findings) {
      if (!allowedSectionIds.has(finding.sectionId) || !allowedNodeIds.has(finding.nodeId)) {
        throw new GrantPatchEvidenceMismatchError("模型诊断引用了未授权或不存在的申请书节点。");
      }
      const node = input.snapshot.nodes.find((candidate) => candidate.nodeId === finding.nodeId);
      if (node?.sectionId !== finding.sectionId) {
        throw new GrantPatchEvidenceMismatchError("模型诊断返回的章节与节点关系不一致。");
      }
    }
    return { ...generated, authorizedEvidenceCardIds: selected.map((item) => item.card.cardId) };
  }

  async validateCurrentEvidence(input: {
    documentId: string;
    proposalId: string;
    bindings: GrantPatchEvidenceBinding[];
  }): Promise<void> {
    if (input.bindings.length === 0) return;
    if (!this.evidenceAuthorization) throw new GrantEvidenceProviderPolicyError("Evidence-backed Patch is not configured.");
    const sourceIds = [...new Set(input.bindings.map((binding) => binding.sourceId))];
    const resources = await this.evidenceAuthorization.materializeCurrent({
      documentId: input.documentId,
      sourceIds,
      taskId: input.proposalId,
      use: "reasoning",
    });
    const currentBySource = new Map(resources.map((resource) => [resource.source.sourceId, resource]));
    for (const binding of input.bindings) {
      const resource = currentBySource.get(binding.sourceId);
      const card = resource?.cards.find((candidate) => candidate.cardId === binding.cardId && candidate.status === "active");
      if (
        !resource
        || resource.authorization.revision !== binding.authorizationRevision
        || resource.source.contentHash !== binding.sourceContentHash
        || card?.excerptHash !== binding.excerptHash
      ) {
        throw new GrantPatchEvidenceMismatchError("修改提案所依赖的资料或授权已经变化，请重新生成。");
      }
    }
  }

  async propose(input: {
    documentId: string;
    snapshot: CanonicalGrantSnapshot;
    targetNodeId: string;
    finding?: GrantFinding;
    userInstruction: string;
    proposalId: string;
    evidenceSourceIds?: string[];
  }): Promise<GrantModelPatchResult> {
    const node = input.snapshot.nodes.find((candidate) => candidate.nodeId === input.targetNodeId);
    const section = input.snapshot.sections.find((candidate) => candidate.sectionId === node?.sectionId);
    const targetText = grantEditableNodeText(input.snapshot, input.targetNodeId);
    const documentLanguage = /[\u3400-\u9fff]/u.test(input.snapshot.title + targetText) ? "zh" : "en";
    const sourceIds = [...new Set(input.evidenceSourceIds ?? [])];
    if (sourceIds.length > 0 && !this.evidenceAuthorization) {
      throw new GrantEvidenceProviderPolicyError("Evidence-backed Patch is not configured.");
    }
    const resources = sourceIds.length === 0 ? [] : await this.evidenceAuthorization!.materializeCurrent({
      documentId: input.documentId,
      sourceIds,
      taskId: input.proposalId,
      use: "model",
    });
    for (const source of resources) {
      if (source.source.sensitivity === "highly_sensitive") {
        throw new GrantEvidenceProviderPolicyError("高度敏感资料不能发送给外部模型供应商。");
      }
    }
    if (sourceIds.length > 0) {
      await this.evidenceAuthorization!.materializeCurrent({
        documentId: input.documentId,
        sourceIds,
        taskId: input.proposalId,
        use: "reasoning",
      });
    }
    const selected = selectGrantEvidenceCards(
      resources,
      [section?.title, targetText, input.finding?.message, input.finding?.recommendation, input.userInstruction].filter(Boolean).join("\n"),
    );
    const generated = await this.model.generate({
      documentLanguage,
      sectionTitle: section?.title ?? "",
      targetText,
      findingMessage: input.finding?.message,
      findingRecommendation: input.finding?.recommendation,
      userInstruction: input.userInstruction,
      evidence: selected.map(({ resource, card }) => ({
        sourceId: resource.source.sourceId,
        cardId: card.cardId,
        sourceTitle: resource.source.title,
        provenanceType: resource.source.provenanceType,
        excerpt: card.excerpt,
      })),
    });
    const allowedByCardId = new Map(selected.map((item) => [item.card.cardId, item]));
    const usedIds = [...new Set(generated.usedEvidenceCardIds)];
    if (sourceIds.length > 0 && usedIds.length === 0) {
      throw new GrantPatchEvidenceMismatchError("所选资料没有形成可验证的修改依据，请调整资料或指令。");
    }
    for (const cardId of usedIds) {
      if (!allowedByCardId.has(cardId)) throw new GrantPatchEvidenceMismatchError("模型引用了未授权的证据卡。");
    }
    if (sourceIds.length > 0) {
      const current = await this.evidenceAuthorization!.materializeCurrent({
        documentId: input.documentId,
        sourceIds,
        taskId: input.proposalId,
        use: "reasoning",
      });
      const revisionBySource = new Map(current.map((item) => [item.source.sourceId, item.authorization.revision]));
      if (resources.some((item) => revisionBySource.get(item.source.sourceId) !== item.authorization.revision)) {
        throw new GrantPatchEvidenceMismatchError("资料授权在模型调用期间发生变化，请重新生成修改提案。");
      }
    }
    return {
      ...generated,
      usedEvidenceCardIds: usedIds,
      evidenceBindings: usedIds.map((cardId) => {
        const { resource, card } = allowedByCardId.get(cardId)!;
        return {
          sourceId: resource.source.sourceId,
          cardId,
          sourceTitle: resource.source.title,
          provenanceType: resource.source.provenanceType,
          sourceContentHash: resource.source.contentHash,
          excerptHash: card.excerptHash,
          authorizationRevision: resource.authorization.revision,
          uses: ["model", "reasoning"] as ["model", "reasoning"],
        };
      }),
    };
  }
}
