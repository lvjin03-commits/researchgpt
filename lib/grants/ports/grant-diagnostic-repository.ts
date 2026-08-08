import type { GrantDiagnosticConflict, GrantDiagnosticRun, GrantFinding } from "../diagnostics/contracts.ts";

export type GrantDiagnosticExecution = {
  runs: GrantDiagnosticRun[];
  findings: GrantFinding[];
  conflicts: GrantDiagnosticConflict[];
};

export interface GrantDiagnosticRepository {
  saveExecution(input: GrantDiagnosticExecution): Promise<GrantDiagnosticExecution>;
  listFindings(documentId: string): Promise<GrantFinding[]>;
  listConflicts(documentId: string): Promise<GrantDiagnosticConflict[]>;
}
