import type { GrantFindingDisposition, GrantFindingFeedback } from "../feedback/contracts.ts";

export interface GrantFeedbackRepository {
  list(documentId: string): Promise<GrantFindingFeedback[]>;
  setDisposition(input: {
    documentId: string;
    findingId: string;
    disposition: GrantFindingDisposition;
    actorId: string;
  }): Promise<GrantFindingFeedback>;
}
