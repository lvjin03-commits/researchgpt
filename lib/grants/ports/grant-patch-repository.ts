import type { GrantPatchProposal } from "../patching/contracts.ts";

export interface GrantPatchRepository {
  create(proposal: GrantPatchProposal): Promise<GrantPatchProposal>;
  get(documentId: string, proposalId: string): Promise<GrantPatchProposal | null>;
  list(documentId: string): Promise<GrantPatchProposal[]>;
  setStatus(input: {
    documentId: string;
    proposalId: string;
    expectedStatus: GrantPatchProposal["status"];
    status: GrantPatchProposal["status"];
    acceptedRevisionId?: string;
    updatedAt: string;
  }): Promise<GrantPatchProposal>;
}

