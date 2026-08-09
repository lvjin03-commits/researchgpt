import { normalizeGrantFindingV2, normalizeGrantFindingV3, toGrantFindingCompatibility } from "../../diagnostics/normalized-finding.ts";
import type { GrantDiagnosticExecution, GrantDiagnosticRepository, GrantSemanticDiagnosticV3Execution } from "../../ports/grant-diagnostic-repository.ts";

function clone<T>(value: T): T { return structuredClone(value); }

export class InMemoryGrantDiagnosticRepository implements GrantDiagnosticRepository {
  private readonly executions: GrantDiagnosticExecution[] = [];
  private readonly semanticV3Executions: GrantSemanticDiagnosticV3Execution[] = [];

  async saveExecution(input: GrantDiagnosticExecution) {
    this.executions.push(clone(input));
    return clone(input);
  }

  async listFindings(documentId: string) {
    return clone(this.executions.flatMap((execution) => execution.findings).filter((finding) => finding.documentId === documentId));
  }

  async listConflicts(documentId: string) {
    return clone(this.executions.flatMap((execution) => execution.conflicts).filter((conflict) => conflict.documentId === documentId));
  }

  async listRuns(documentId: string) {
    return clone(this.executions.flatMap((execution) => execution.runs).filter((run) => run.documentId === documentId).reverse());
  }

  async saveSemanticV3Execution(input: GrantSemanticDiagnosticV3Execution) {
    const stored = clone(input);
    this.semanticV3Executions.push(stored);
    this.executions.push({
      runs: [stored.run],
      findings: stored.findings.map(toGrantFindingCompatibility),
      conflicts: [],
    });
    return clone(stored);
  }

  async listNormalizedFindings(documentId: string) {
    const v3ByFindingId = new Map(this.semanticV3Executions
      .flatMap((execution) => execution.findings)
      .filter((finding) => finding.documentId === documentId)
      .map((finding) => [finding.findingId, normalizeGrantFindingV3(finding)]));
    const v2 = this.executions.flatMap((execution) => execution.findings)
      .filter((finding) => finding.documentId === documentId && !v3ByFindingId.has(finding.findingId))
      .map(normalizeGrantFindingV2);
    return clone([...v2, ...v3ByFindingId.values()]);
  }
}
