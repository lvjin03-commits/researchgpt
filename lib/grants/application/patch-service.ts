import { randomUUID } from "node:crypto";
import type { GrantDiagnosticRepository } from "../ports/grant-diagnostic-repository.ts";
import type { GrantPatchRepository } from "../ports/grant-patch-repository.ts";
import { GrantPatchProposalSchema, type GrantPatchProposal } from "../patching/contracts.ts";
import { applyGrantPatch, grantEditableNodeText, grantTextHash, validateGrantPatchFactSafety } from "../patching/patch-policy.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { GrantModelDataGateway } from "./grant-model-data-gateway.ts";
import { GrantRevisionConflictError, GrantRevisionService } from "./revision-service.ts";
import { resolveGrantSourceAnchor } from "../diagnostics/anchors.ts";

export class GrantPatchNotFoundError extends Error {}
export class GrantPatchStateError extends Error {}

export class GrantPatchService {
  private readonly revisionService: GrantRevisionService;
  private readonly diagnosticRepository: GrantDiagnosticRepository;
  private readonly repository: GrantPatchRepository;
  private readonly gateway: GrantModelDataGateway;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    revisionService: GrantRevisionService,
    diagnosticRepository: GrantDiagnosticRepository,
    repository: GrantPatchRepository,
    gateway: GrantModelDataGateway,
    createId: () => string = randomUUID,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.revisionService = revisionService;
    this.diagnosticRepository = diagnosticRepository;
    this.repository = repository;
    this.gateway = gateway;
    this.createId = createId;
    this.now = now;
  }

  async list(documentId: string) {
    await this.revisionService.getDocument(documentId);
    return this.repository.list(documentId);
  }

  async propose(input: {
    documentId: string;
    baseRevisionId: string;
    targetNodeId: string;
    findingId?: string;
    instruction: string;
    editMode?: "replace" | "replace_selection" | "insert_after";
    selection?: { startOffset: number; endOffset: number; text: string };
    actorId: string;
    evidenceSourceIds?: string[];
  }): Promise<GrantPatchProposal> {
    const aggregate = await this.revisionService.getDocument(input.documentId);
    if (aggregate.currentRevision.revisionId !== input.baseRevisionId) {
      throw new GrantRevisionConflictError(aggregate.currentRevision.revisionId);
    }
    const finding = input.findingId
      ? (await this.diagnosticRepository.listFindings(input.documentId)).find((candidate) => candidate.findingId === input.findingId)
      : undefined;
    if (input.findingId && !finding) throw new GrantPatchNotFoundError("The selected finding was not found.");
    if (finding) {
      const resolution = resolveGrantSourceAnchor(
        finding.sourceAnchor,
        aggregate.currentRevision.revisionId,
        aggregate.currentRevision.snapshot,
      );
      if ((resolution.status !== "exact" && resolution.status !== "relocated") || resolution.targetNodeId !== input.targetNodeId) {
        throw new GrantPatchStateError("The selected finding does not authorize this target node.");
      }
    }
    const proposalId = this.createId();
    const oldText = grantEditableNodeText(aggregate.currentRevision.snapshot, input.targetNodeId);
    const selection = input.editMode === "replace_selection" ? input.selection : undefined;
    if (input.editMode === "replace_selection" && (!selection
      || selection.startOffset >= selection.endOffset
      || selection.endOffset > oldText.length
      || oldText.slice(selection.startOffset, selection.endOffset) !== selection.text)) {
      throw new GrantPatchStateError("The selected text no longer matches the target node.");
    }
    const generated = await this.gateway.propose({
      documentId: input.documentId,
      snapshot: aggregate.currentRevision.snapshot,
      targetNodeId: input.targetNodeId,
      finding,
      userInstruction: input.instruction,
      editMode: input.editMode ?? "replace",
      selectedText: selection?.text,
      proposalId,
      evidenceSourceIds: input.evidenceSourceIds,
    });
    const timestamp = this.now();
    validateGrantPatchFactSafety({
      oldText: selection?.text ?? oldText,
      newText: generated.replacementText,
      hasAuthorizedEvidence: generated.evidenceBindings.length > 0,
    });
    const proposal = GrantPatchProposalSchema.parse({
      proposalId,
      documentId: input.documentId,
      baseRevisionId: input.baseRevisionId,
      findingId: input.findingId,
      targetNodeIds: [input.targetNodeId],
      instruction: input.instruction,
      operations: input.editMode === "insert_after" ? [{
        type: "insert_after",
        anchorNodeId: input.targetNodeId,
        expectedAnchorTextHash: grantTextHash(oldText),
        anchorText: oldText,
        newNodeId: this.createId(),
        newText: generated.replacementText,
      }] : input.editMode === "replace_selection" ? [{
        type: "replace_selection",
        nodeId: input.targetNodeId,
        expectedTextHash: grantTextHash(oldText),
        startOffset: selection!.startOffset,
        endOffset: selection!.endOffset,
        oldText: selection!.text,
        newText: generated.replacementText,
      }] : [{
        type: "replace_text",
        nodeId: input.targetNodeId,
        expectedTextHash: grantTextHash(oldText),
        oldText,
        newText: generated.replacementText,
      }],
      status: "pending",
      createdBy: input.actorId,
      modelProvider: generated.provider,
      modelId: generated.modelId,
      rationale: generated.rationale,
      evidenceBindings: generated.evidenceBindings,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    applyGrantPatch(aggregate.currentRevision.snapshot, proposal);
    const evidenceDependencies = [...new Set(proposal.evidenceBindings.map((binding) => binding.sourceId))].map((sourceId) => ({
      dependencyId: this.createId(),
      documentId: proposal.documentId,
      sourceId,
      dependentKind: "patch_proposal" as const,
      dependentId: proposal.proposalId,
      status: "active" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    return this.repository.create(proposal, evidenceDependencies);
  }

  async accept(documentId: string, proposalId: string, actorId: string) {
    const proposal = await this.repository.get(documentId, proposalId);
    if (!proposal) throw new GrantPatchNotFoundError("The patch proposal was not found.");
    if (proposal.status === "accepted" && proposal.acceptedRevisionId) {
      return { proposal, aggregate: await this.revisionService.getDocument(documentId) };
    }
    if (proposal.status !== "pending") throw new GrantPatchStateError("This proposal can no longer be accepted.");

    await this.gateway.validateCurrentEvidence({
      documentId,
      proposalId,
      bindings: proposal.evidenceBindings,
    });

    const existingAudit = (await this.revisionService.listAuditEvents(documentId)).find(
      (event) => event.metadata.patchProposalId === proposalId,
    );
    if (existingAudit?.revisionId) {
      const recovered = await this.repository.setStatus({
        documentId,
        proposalId,
        expectedStatus: "pending",
        status: "accepted",
        acceptedRevisionId: existingAudit.revisionId,
        updatedAt: this.now(),
      });
      return { proposal: recovered, aggregate: await this.revisionService.getDocument(documentId) };
    }

    const aggregate = await this.revisionService.getDocument(documentId);
    if (aggregate.currentRevision.revisionId !== proposal.baseRevisionId) {
      await this.repository.setStatus({
        documentId,
        proposalId,
        expectedStatus: "pending",
        status: "invalidated",
        updatedAt: this.now(),
      });
      throw new GrantRevisionConflictError(aggregate.currentRevision.revisionId);
    }
    const next = await this.revisionService.commitRevision({
      documentId,
      expectedRevisionId: proposal.baseRevisionId,
      actorId,
      actorKind: "user",
      snapshot: applyGrantPatch(aggregate.currentRevision.snapshot, proposal),
      reason: "accept_ai_patch_proposal",
      evidencePatchProposalId: proposal.evidenceBindings.length > 0 ? proposal.proposalId : undefined,
      auditMetadata: {
        patchProposalId: proposal.proposalId,
        findingId: proposal.findingId,
        targetNodeIds: proposal.targetNodeIds,
        instructionHash: sha256Canonical(proposal.instruction),
        contentOrigin: "ai_proposal",
        evidenceSourceIds: [...new Set(proposal.evidenceBindings.map((binding) => binding.sourceId))],
        evidenceCardIds: proposal.evidenceBindings.map((binding) => binding.cardId),
        evidenceAuthorizationRevisions: Object.fromEntries(
          proposal.evidenceBindings.map((binding) => [binding.sourceId, binding.authorizationRevision]),
        ),
      },
    });
    if (proposal.evidenceBindings.length > 0) {
      const transactionallyAccepted = await this.repository.get(documentId, proposalId);
      if (transactionallyAccepted?.status === "accepted") {
        return { proposal: transactionallyAccepted, aggregate: next };
      }
    }
    const accepted = await this.repository.setStatus({
      documentId,
      proposalId,
      expectedStatus: "pending",
      status: "accepted",
      acceptedRevisionId: next.currentRevision.revisionId,
      updatedAt: this.now(),
    });
    return { proposal: accepted, aggregate: next };
  }

  async reject(documentId: string, proposalId: string) {
    const proposal = await this.repository.get(documentId, proposalId);
    if (!proposal) throw new GrantPatchNotFoundError("The patch proposal was not found.");
    if (proposal.status !== "pending") throw new GrantPatchStateError("This proposal can no longer be rejected.");
    return this.repository.setStatus({
      documentId,
      proposalId,
      expectedStatus: "pending",
      status: "rejected",
      updatedAt: this.now(),
    });
  }
}
