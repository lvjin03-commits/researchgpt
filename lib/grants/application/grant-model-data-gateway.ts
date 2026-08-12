import { createHash } from "node:crypto";
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
import { buildGrantSemanticReviewV6PreparedInputV1 } from "../diagnostics/semantic-review-v6-input.ts";
import type { GrantSemanticReviewV6PortableCheckpoint } from "../diagnostics/semantic-review-v6-persistence.ts";
import type { GrantArgumentMapV1 } from "../diagnostics/hierarchical-semantic-contracts.ts";
import { GrantFigureAuthorizationDeniedError, GrantFigureModelAuthorizationService } from "./figure-model-authorization-service.ts";
import type { GrantFigureAssetReader } from "../ports/grant-figure-asset-reader.ts";
import {
  GRANT_DIAGNOSTIC_IMAGE_MEDIA_TYPES,
  grantDiagnosticImageScopeFingerprint,
  textOnlyGrantDiagnosticImageAdmission,
  type GrantDiagnosticImageAdmission,
  type GrantDiagnosticImageMediaType,
} from "../diagnostics/multimodal-diagnostic-input.ts";

export class GrantEvidenceProviderPolicyError extends Error {}
export class GrantPatchEvidenceMismatchError extends Error {}

export type GrantModelPatchResult = GrantPatchModelResult & {
  evidenceBindings: GrantPatchEvidenceBinding[];
};

export class GrantModelDataGateway {
  private readonly model: GrantPatchModel & Partial<GrantDiagnosticModel>;
  private readonly evidenceAuthorization?: GrantEvidenceAuthorizationService;
  private readonly figureAuthorization?: GrantFigureModelAuthorizationService;
  private readonly figureAssetReader?: GrantFigureAssetReader;

  constructor(
    model: GrantPatchModel & Partial<GrantDiagnosticModel>,
    evidenceAuthorization?: GrantEvidenceAuthorizationService,
    figureAuthorization?: GrantFigureModelAuthorizationService,
    figureAssetReader?: GrantFigureAssetReader,
  ) {
    this.model = model;
    this.evidenceAuthorization = evidenceAuthorization;
    this.figureAuthorization = figureAuthorization;
    this.figureAssetReader = figureAssetReader;
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
    const generated = await this.model.diagnoseHierarchical(
      prepared,
      input.argumentMapCheckpoint,
      this.createDiagnosticImageAdmission(input.documentId, prepared),
    );
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
    documentId: string,
    prepared: ReturnType<GrantModelDataGateway["prepareDiagnosticHierarchicalInput"]> extends Promise<infer T> ? T : never,
    argumentMapCheckpoint?: GrantArgumentMapV1,
  ) {
    if (!this.model.diagnoseHierarchical) {
      throw new GrantEvidenceProviderPolicyError("Grant hierarchical semantic diagnosis is not configured.");
    }
    return this.model.diagnoseHierarchical(
      prepared,
      argumentMapCheckpoint,
      this.createDiagnosticImageAdmission(documentId, prepared),
    );
  }

  async prepareDiagnosticSemanticReviewV6Input(input: Parameters<GrantModelDataGateway["prepareDiagnosticHierarchicalInput"]>[0]) {
    const hierarchical = await this.prepareDiagnosticHierarchicalInput(input);
    return buildGrantSemanticReviewV6PreparedInputV1({ prepared: hierarchical });
  }

  async executeDiagnosticSemanticReviewV6Input(
    documentId: string,
    prepared: Awaited<ReturnType<GrantModelDataGateway["prepareDiagnosticSemanticReviewV6Input"]>>,
    checkpoint?: GrantSemanticReviewV6PortableCheckpoint,
  ) {
    if (!this.model.diagnoseSemanticReviewV6) {
      throw new GrantEvidenceProviderPolicyError("Grant Semantic Review V6 is not configured.");
    }
    return this.model.diagnoseSemanticReviewV6(
      prepared,
      checkpoint,
      this.createDiagnosticImageAdmission(documentId, prepared),
    );
  }

  private createDiagnosticImageAdmission(
    documentId: string,
    prepared: Awaited<ReturnType<GrantModelDataGateway["prepareDiagnosticHierarchicalInput"]>>
      | Awaited<ReturnType<GrantModelDataGateway["prepareDiagnosticSemanticReviewV6Input"]>>,
  ) {
    return () => this.materializeDiagnosticImages(documentId, prepared);
  }

  private async materializeDiagnosticImages(
    documentId: string,
    prepared: Awaited<ReturnType<GrantModelDataGateway["prepareDiagnosticHierarchicalInput"]>>
      | Awaited<ReturnType<GrantModelDataGateway["prepareDiagnosticSemanticReviewV6Input"]>>,
  ): Promise<GrantDiagnosticImageAdmission> {
    const candidateCount = prepared.figureLocationRefByAssetId.size;
    if (candidateCount === 0) {
      return textOnlyGrantDiagnosticImageAdmission({ candidateCount, reasons: ["no_figures_in_scope"] });
    }
    if (!this.figureAuthorization || !this.figureAssetReader) {
      return textOnlyGrantDiagnosticImageAdmission({ candidateCount, reasons: ["asset_unavailable"] });
    }

    let materialized: Awaited<ReturnType<GrantFigureModelAuthorizationService["materializeCurrentForSemanticDiagnosis"]>>;
    try {
      materialized = await this.figureAuthorization.materializeCurrentForSemanticDiagnosis(documentId);
    } catch (error) {
      if (error instanceof GrantFigureAuthorizationDeniedError) {
        return textOnlyGrantDiagnosticImageAdmission({ candidateCount, reasons: ["not_authorized"] });
      }
      return textOnlyGrantDiagnosticImageAdmission({ candidateCount, reasons: ["asset_unavailable"] });
    }

    const supportedMediaTypes = new Set<string>(GRANT_DIAGNOSTIC_IMAGE_MEDIA_TYPES);
    const scopedAssets = materialized.assets
      .filter((asset) => prepared.figureLocationRefByAssetId.has(asset.assetId))
      .sort((left, right) => {
        const leftRef = prepared.figureLocationRefByAssetId.get(left.assetId)!;
        const rightRef = prepared.figureLocationRefByAssetId.get(right.assetId)!;
        return Number(leftRef.slice(1)) - Number(rightRef.slice(1));
      });
    const authorizedCount = scopedAssets.length;
    const reasons = new Set<GrantDiagnosticImageAdmission["coverage"]["reasons"][number]>();
    if (authorizedCount < candidateCount) reasons.add("not_authorized");
    const accepted: Array<{
      locationRef: string;
      caption: string | null;
      mediaType: GrantDiagnosticImageMediaType;
      contentHash: string;
      bytes: Uint8Array;
    }> = [];
    const maxImageBytes = 8 * 1024 * 1024;
    const maxTotalBytes = 20 * 1024 * 1024;
    const maxImages = 8;
    let totalBytes = 0;

    for (const asset of scopedAssets) {
      if (!supportedMediaTypes.has(asset.mediaType)) {
        reasons.add("unsupported_media_type");
        continue;
      }
      if (asset.byteSize > maxImageBytes) {
        reasons.add("image_too_large");
        continue;
      }
      if (accepted.length >= maxImages || totalBytes + asset.byteSize > maxTotalBytes) {
        reasons.add("image_capacity_limit");
        continue;
      }
      try {
        const bytes = await this.figureAssetReader.readBytes(asset);
        const contentHash = createHash("sha256").update(bytes).digest("hex");
        if (bytes.byteLength !== asset.byteSize || contentHash !== asset.contentHash) {
          reasons.add("asset_unavailable");
          continue;
        }
        accepted.push({
          locationRef: prepared.figureLocationRefByAssetId.get(asset.assetId)!,
          caption: asset.anchor.caption.text,
          mediaType: asset.mediaType as GrantDiagnosticImageMediaType,
          contentHash,
          bytes,
        });
        totalBytes += bytes.byteLength;
      } catch {
        reasons.add("asset_unavailable");
      }
    }

    try {
      const current = await this.figureAuthorization.materializeCurrentForSemanticDiagnosis(documentId);
      if (
        current.authorization.authorizationId !== materialized.authorization.authorizationId
        || current.authorization.authorizationRevision !== materialized.authorization.authorizationRevision
        || current.authorization.sourceRevisionId !== prepared.sourceRevisionId
      ) {
        return textOnlyGrantDiagnosticImageAdmission({
          candidateCount,
          authorizedCount,
          reasons: ["authorization_changed"],
        });
      }
    } catch {
      return textOnlyGrantDiagnosticImageAdmission({
        candidateCount,
        authorizedCount,
        reasons: ["authorization_changed"],
      });
    }

    const images = accepted.map((image, index) => ({
      imageRef: `I${index + 1}`,
      locationRef: image.locationRef,
      caption: image.caption,
      mediaType: image.mediaType,
      dataUrl: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString("base64")}`,
    }));
    if (images.length === 0) {
      return textOnlyGrantDiagnosticImageAdmission({
        candidateCount,
        authorizedCount,
        reasons: reasons.size > 0 ? [...reasons] : ["not_authorized"],
      });
    }
    const imageScopeFingerprint = grantDiagnosticImageScopeFingerprint(accepted.map((image, index) => ({
      imageRef: `I${index + 1}`,
      locationRef: image.locationRef,
      contentHash: image.contentHash,
    })));
    return {
      images,
      coverage: {
        mode: "multimodal",
        candidateCount,
        authorizedCount,
        suppliedCount: images.length,
        omittedCount: candidateCount - images.length,
        reasons: [...reasons],
        imageScopeFingerprint,
      },
    };
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
    editMode: "replace" | "insert_after";
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
      editMode: input.editMode,
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
