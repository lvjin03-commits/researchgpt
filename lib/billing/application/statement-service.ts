import type { PointStatementRepository } from "../ports/statement-repository.ts";

export class PointStatementService {
  private readonly repository: PointStatementRepository;
  constructor(repository: PointStatementRepository) { this.repository = repository; }

  getStatement(input: { ownerId: string; cursor?: string; limit?: number }) {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Statement limit must be between 1 and 100.");
    return this.repository.getStatement({ ownerId: input.ownerId, cursor: input.cursor ?? null, limit });
  }
}
