import { z } from "zod";
import { GrantFindingDispositionSchema } from "../feedback/contracts.ts";
import type { GrantFeedbackRepository } from "../ports/grant-feedback-repository.ts";

const UuidSchema = z.string().uuid();

export class GrantFeedbackService {
  private readonly repository: GrantFeedbackRepository;

  constructor(repository: GrantFeedbackRepository) {
    this.repository = repository;
  }

  list(documentId: string) {
    return this.repository.list(UuidSchema.parse(documentId));
  }

  setDisposition(input: {
    documentId: string;
    findingId: string;
    disposition: unknown;
    actorId: string;
  }) {
    return this.repository.setDisposition({
      documentId: UuidSchema.parse(input.documentId),
      findingId: UuidSchema.parse(input.findingId),
      disposition: GrantFindingDispositionSchema.parse(input.disposition),
      actorId: UuidSchema.parse(input.actorId),
    });
  }
}
