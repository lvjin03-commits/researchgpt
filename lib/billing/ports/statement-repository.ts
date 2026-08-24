import type { PointStatement, PointStatementFilter } from "../domain/statements.ts";

export interface PointStatementRepository {
  getStatement(input: { ownerId: string; cursor: string | null; limit: number; kind: PointStatementFilter | null }): Promise<PointStatement>;
}
