import { randomUUID } from "node:crypto";
import type { GrantDiagnosticRepository } from "../ports/grant-diagnostic-repository.ts";
import type { GrantPatchRepository } from "../ports/grant-patch-repository.ts";
import { GrantPatchProposalSchema, type GrantPatchProposal } from "../patching/contracts.ts";
import { applyGrantPatch, grantEditableNodeText, grantTextHash } from "../patching/patch-policy.ts";
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
    actorId: string;
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
    const oldText = grantEditableNodeText(aggregate.currentRevision.snapshot, input.targetNodeId);
    const generated = await this.gateway.propose({
      snapshot: aggregate.currentRevision.snapshot,
      targetNodeId: input.targetNodeId,
      finding,
      userInstruction: input.instruction,
    });
    const timestamp = this.now();
    const proposal = GrantPatchProposalSchema.parse({
      proposalId: this.createId(),
      documentId: input.documentId,
      baseRevisionId: input.baseRevisionId,
      findingId: input.findingId,
      targetNodeIds: [input.targetNodeId],
      instruction: input.instruction,
      operations: [{
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
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    applyGrantPatch(aggregate.currentRevision.snapshot, proposal);
    return this.repository.create(proposal);
  }

  async accept(documentId: string, proposalId: string, actorId: string) {
    const proposal = await this.repository.get(documentId, proposalId);
    if (!proposal) throw new GrantPatchNotFoundError("The patch proposal was not found.");
    if (proposal.status === "accepted" && proposal.acceptedRevisionId) {
      return { proposal, aggregate: await this.revisionService.getDocument(documentId) };
    }
    if (proposal.status !== "pending") throw new GrantPatchStateError("This proposal can no longer be accepted.");

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
      auditMetadata: {
        patchProposalId: proposal.proposalId,
        findingId: proposal.findingId,
        targetNodeIds: proposal.targetNodeIds,
        instructionHash: sha256Canonical(proposal.instruction),
        contentOrigin: "ai_proposal",
      },
    });
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
