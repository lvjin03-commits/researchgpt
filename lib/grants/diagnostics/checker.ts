import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantDiagnosticInputMode, GrantFindingAssessment } from "./contracts.ts";

export type GrantCheckerInput = {
  documentId: string;
  revisionId: string;
  snapshot: CanonicalGrantSnapshot;
  inputMode: GrantDiagnosticInputMode;
  inputNodeIds: string[];
};

export type GrantCheckerFindingCandidate = {
  code: string;
  message: string;
  recommendation: string;
  assessment: GrantFindingAssessment;
  subjectKey: string;
  conclusion: string;
  sectionId?: string;
  nodeId?: string;
  startOffset?: number;
  endOffset?: number;
};

export type GrantCheckerOutput = {
  findings: GrantCheckerFindingCandidate[];
  metadata?: Record<string, unknown>;
};

export interface GrantChecker {
  readonly checkerId: string;
  readonly checkerVersion: string;
  readonly contractVersion: string;
  readonly inputMode: GrantDiagnosticInputMode;
  check(input: GrantCheckerInput): Promise<GrantCheckerOutput>;
}
