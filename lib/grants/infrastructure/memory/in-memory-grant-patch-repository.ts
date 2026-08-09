import type { GrantPatchProposal } from "../../patching/contracts.ts";
import type { GrantPatchRepository } from "../../ports/grant-patch-repository.ts";

export class InMemoryGrantPatchRepository implements GrantPatchRepository {
  private readonly proposals = new Map<string, GrantPatchProposal>();

  async create(proposal: GrantPatchProposal) {
    if (this.proposals.has(proposal.proposalId)) throw new Error("Grant patch proposal already exists.");
    this.proposals.set(proposal.proposalId, structuredClone(proposal));
    return structuredClone(proposal);
  }

  async get(documentId: string, proposalId: string) {
    const proposal = this.proposals.get(proposalId);
    return proposal?.documentId === documentId ? structuredClone(proposal) : null;
  }

  async list(documentId: string) {
    return [...this.proposals.values()]
      .filter((proposal) => proposal.documentId === documentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((proposal) => structuredClone(proposal));
  }

  async setStatus(input: Parameters<GrantPatchRepository["setStatus"]>[0]) {
    const proposal = await this.get(input.documentId, input.proposalId);
    if (!proposal) throw new Error("Grant patch proposal was not found.");
    if (proposal.status !== input.expectedStatus) throw new Error("Grant patch proposal status changed.");
    const next: GrantPatchProposal = {
      ...proposal,
      status: input.status,
      acceptedRevisionId: input.acceptedRevisionId,
      updatedAt: input.updatedAt,
    };
    this.proposals.set(next.proposalId, structuredClone(next));
    return structuredClone(next);
  }
}
