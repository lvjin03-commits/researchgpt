import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantFinding } from "../diagnostics/contracts.ts";
import type { GrantPatchModel, GrantPatchModelResult } from "../ports/grant-patch-model.ts";
import { grantEditableNodeText } from "../patching/patch-policy.ts";
import type { GrantPatchEvidenceBinding } from "../patching/contracts.ts";
import { GrantEvidenceAuthorizationService } from "./evidence-authorization-service.ts";
import { selectGrantEvidenceCards } from "./grant-evidence-selector.ts";

export class GrantEvidenceProviderPolicyError extends Error {}
export class GrantPatchEvidenceMismatchError extends Error {}

export type GrantModelPatchResult = GrantPatchModelResult & {
  evidenceBindings: GrantPatchEvidenceBinding[];
};

export class GrantModelDataGateway {
  private readonly model: GrantPatchModel;
  private readonly evidenceAuthorization?: GrantEvidenceAuthorizationService;

  constructor(model: GrantPatchModel, evidenceAuthorization?: GrantEvidenceAuthorizationService) {
    this.model = model;
    this.evidenceAuthorization = evidenceAuthorization;
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
