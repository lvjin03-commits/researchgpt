import type { PointStatement } from "../domain/statements.ts";

export interface PointStatementRepository {
  getStatement(input: { ownerId: string; cursor: string | null; limit: number }): Promise<PointStatement>;
}
