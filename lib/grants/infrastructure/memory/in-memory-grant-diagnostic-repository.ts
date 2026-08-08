import type { GrantDiagnosticExecution, GrantDiagnosticRepository } from "../../ports/grant-diagnostic-repository.ts";

function clone<T>(value: T): T { return structuredClone(value); }

export class InMemoryGrantDiagnosticRepository implements GrantDiagnosticRepository {
  private readonly executions: GrantDiagnosticExecution[] = [];

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
}
