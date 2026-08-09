import type { GrantDiagnosticConflict, GrantDiagnosticRun, GrantFinding } from "../diagnostics/contracts.ts";
import type { GrantNormalizedFinding } from "../diagnostics/normalized-finding.ts";
import type { AssembledGrantSemanticFindingV3 } from "../diagnostics/semantic-v3-assembler.ts";

export type GrantDiagnosticExecution = {
  runs: GrantDiagnosticRun[];
  findings: GrantFinding[];
  conflicts: GrantDiagnosticConflict[];
};

export type GrantSemanticDiagnosticV3Execution = {
  run: GrantDiagnosticRun;
  findings: AssembledGrantSemanticFindingV3[];
};

export interface GrantDiagnosticRepository {
  saveExecution(input: GrantDiagnosticExecution): Promise<GrantDiagnosticExecution>;
  listFindings(documentId: string): Promise<GrantFinding[]>;
  listConflicts(documentId: string): Promise<GrantDiagnosticConflict[]>;
  listRuns?(documentId: string): Promise<GrantDiagnosticRun[]>;
  saveSemanticV3Execution?(input: GrantSemanticDiagnosticV3Execution): Promise<GrantSemanticDiagnosticV3Execution>;
  listNormalizedFindings?(documentId: string): Promise<GrantNormalizedFinding[]>;
}
