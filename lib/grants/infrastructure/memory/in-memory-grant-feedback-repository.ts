import type { GrantFindingFeedback } from "../../feedback/contracts.ts";
import type { GrantFeedbackRepository } from "../../ports/grant-feedback-repository.ts";

export class InMemoryGrantFeedbackRepository implements GrantFeedbackRepository {
  private readonly feedback = new Map<string, GrantFindingFeedback>();

  async list(documentId: string) {
    return structuredClone([...this.feedback.values()].filter((item) => item.documentId === documentId));
  }

  async setDisposition(input: Parameters<GrantFeedbackRepository["setDisposition"]>[0]) {
    const item: GrantFindingFeedback = {
      findingId: input.findingId,
      documentId: input.documentId,
      disposition: input.disposition,
      updatedBy: input.actorId,
      updatedAt: new Date().toISOString(),
    };
    this.feedback.set(input.findingId, item);
    return structuredClone(item);
  }
}
