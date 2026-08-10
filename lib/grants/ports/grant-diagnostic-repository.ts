import type { GrantDiagnosticConflict, GrantDiagnosticRun, GrantFinding } from "../diagnostics/contracts.ts";
import type { GrantNormalizedFinding } from "../diagnostics/normalized-finding.ts";
import type { AssembledGrantSemanticFindingV3 } from "../diagnostics/semantic-v3-assembler.ts";
import type { AssembledGrantHierarchicalFindingV1 } from "../diagnostics/hierarchical-finding-assembler.ts";
import type { GrantArgumentMapCheckpointV1, GrantHierarchicalContinuityLinkV1 } from "../diagnostics/hierarchical-semantic-contracts.ts";

export type GrantDiagnosticExecution = {
  runs: GrantDiagnosticRun[];
  findings: GrantFinding[];
  conflicts: GrantDiagnosticConflict[];
};

export type GrantSemanticDiagnosticV3Execution = {
  run: GrantDiagnosticRun;
  findings: AssembledGrantSemanticFindingV3[];
};

export type GrantHierarchicalDiagnosticExecutionV1 = {
  run: GrantDiagnosticRun;
  findings: AssembledGrantHierarchicalFindingV1[];
  argumentMapCheckpoint: GrantArgumentMapCheckpointV1;
  continuityLinks: GrantHierarchicalContinuityLinkV1[];
};

export interface GrantDiagnosticRepository {
  saveExecution(input: GrantDiagnosticExecution): Promise<GrantDiagnosticExecution>;
  listFindings(documentId: string): Promise<GrantFinding[]>;
  listConflicts(documentId: string): Promise<GrantDiagnosticConflict[]>;
  listRuns?(documentId: string): Promise<GrantDiagnosticRun[]>;
  saveSemanticV3Execution?(input: GrantSemanticDiagnosticV3Execution): Promise<GrantSemanticDiagnosticV3Execution>;
  saveHierarchicalExecution?(input: GrantHierarchicalDiagnosticExecutionV1): Promise<GrantHierarchicalDiagnosticExecutionV1>;
  saveArgumentMapCheckpoint?(input: GrantArgumentMapCheckpointV1): Promise<GrantArgumentMapCheckpointV1>;
  findArgumentMapCheckpoint?(input: {
    documentId: string;
    sourceRevisionId: string;
    checkerId: string;
    checkerVersion: string;
    inputFingerprint: string;
    locationScopeFingerprint: string;
  }): Promise<GrantArgumentMapCheckpointV1 | null>;
  listNormalizedFindings?(documentId: string): Promise<GrantNormalizedFinding[]>;
}
