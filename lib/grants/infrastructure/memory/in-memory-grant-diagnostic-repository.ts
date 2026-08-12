import { normalizeGrantFindingHierarchical, normalizeGrantFindingV2, normalizeGrantFindingV3, toGrantFindingCompatibility, toGrantFindingHierarchicalCompatibility } from "../../diagnostics/normalized-finding.ts";
import type { GrantArgumentMapCheckpointV1 } from "../../diagnostics/hierarchical-semantic-contracts.ts";
import type { GrantDiagnosticExecution, GrantDiagnosticRepository, GrantHierarchicalDiagnosticExecutionV1, GrantSemanticDiagnosticV3Execution } from "../../ports/grant-diagnostic-repository.ts";
import type { GrantSemanticReviewV6CheckpointRecord } from "../../diagnostics/semantic-review-v6-persistence.ts";
import type { GrantSemanticReviewV6Execution } from "../../ports/grant-diagnostic-repository.ts";

function clone<T>(value: T): T { return structuredClone(value); }

export class InMemoryGrantDiagnosticRepository implements GrantDiagnosticRepository {
  private readonly executions: GrantDiagnosticExecution[] = [];
  private readonly semanticV3Executions: GrantSemanticDiagnosticV3Execution[] = [];
  private readonly hierarchicalExecutions: GrantHierarchicalDiagnosticExecutionV1[] = [];
  private readonly argumentMapCheckpoints: GrantArgumentMapCheckpointV1[] = [];
  private readonly semanticReviewV6Executions: GrantSemanticReviewV6Execution[] = [];
  private readonly semanticReviewV6Checkpoints: GrantSemanticReviewV6CheckpointRecord[] = [];

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

  async saveArgumentMapCheckpoint(input: GrantArgumentMapCheckpointV1) {
    const stored = clone(input);
    const existingIndex = this.argumentMapCheckpoints.findIndex((checkpoint) => checkpoint.checkpointId === stored.checkpointId);
    if (existingIndex >= 0) this.argumentMapCheckpoints[existingIndex] = stored;
    else this.argumentMapCheckpoints.push(stored);
    return clone(stored);
  }

  async findArgumentMapCheckpoint(input: {
    documentId: string;
    sourceRevisionId: string;
    checkerId: string;
    checkerVersion: string;
    inputFingerprint: string;
    locationScopeFingerprint: string;
  }) {
    const checkpoint = [...this.argumentMapCheckpoints].reverse().find((candidate) =>
      candidate.status === "ready"
      && candidate.documentId === input.documentId
      && candidate.sourceRevisionId === input.sourceRevisionId
      && candidate.checkerId === input.checkerId
      && candidate.checkerVersion === input.checkerVersion
      && candidate.inputFingerprint === input.inputFingerprint
      && candidate.locationScopeFingerprint === input.locationScopeFingerprint
    );
    return checkpoint ? clone(checkpoint) : null;
  }

  async saveHierarchicalExecution(input: GrantHierarchicalDiagnosticExecutionV1) {
    const stored = clone(input);
    this.hierarchicalExecutions.push(stored);
    this.executions.push({
      runs: [stored.run],
      findings: stored.findings.map(toGrantFindingHierarchicalCompatibility),
      conflicts: [],
    });
    await this.saveArgumentMapCheckpoint({ ...stored.argumentMapCheckpoint, status: "consumed" });
    return clone(stored);
  }

  async saveSemanticReviewV6Checkpoint(input: GrantSemanticReviewV6CheckpointRecord) {
    const stored = clone(input);
    const existingIndex = this.semanticReviewV6Checkpoints.findIndex((item) => item.checkpointId === stored.checkpointId);
    if (existingIndex >= 0) this.semanticReviewV6Checkpoints[existingIndex] = stored;
    else this.semanticReviewV6Checkpoints.push(stored);
    return clone(stored);
  }

  async findSemanticReviewV6Checkpoint(input: {
    documentId: string;
    sourceRevisionId: string;
    checkerId: string;
    checkerVersion: string;
    inputFingerprint: string;
    locationScopeFingerprint: string;
  }) {
    const checkpoint = [...this.semanticReviewV6Checkpoints].reverse().find((candidate) =>
      candidate.status === "ready"
      && candidate.documentId === input.documentId
      && candidate.sourceRevisionId === input.sourceRevisionId
      && candidate.checkerId === input.checkerId
      && candidate.checkerVersion === input.checkerVersion
      && candidate.inputFingerprint === input.inputFingerprint
      && candidate.locationScopeFingerprint === input.locationScopeFingerprint
    );
    return checkpoint ? clone(checkpoint) : null;
  }

  async saveSemanticReviewV6Execution(input: GrantSemanticReviewV6Execution) {
    const stored = clone(input);
    this.semanticReviewV6Executions.push(stored);
    this.executions.push({ runs: [stored.run], findings: stored.findings, conflicts: [] });
    await this.saveSemanticReviewV6Checkpoint({ ...stored.checkpoint, status: "consumed" });
    return clone(stored);
  }

  async listNormalizedFindings(documentId: string) {
    const hierarchicalByFindingId = new Map(this.hierarchicalExecutions
      .flatMap((execution) => execution.findings)
      .filter((finding) => finding.documentId === documentId)
      .map((finding) => [finding.findingId, normalizeGrantFindingHierarchical(finding)]));
    const v3ByFindingId = new Map(this.semanticV3Executions
      .flatMap((execution) => execution.findings)
      .filter((finding) => finding.documentId === documentId)
      .map((finding) => [finding.findingId, normalizeGrantFindingV3(finding)]));
    const v2 = this.executions.flatMap((execution) => execution.findings)
      .filter((finding) => finding.documentId === documentId && !v3ByFindingId.has(finding.findingId) && !hierarchicalByFindingId.has(finding.findingId))
      .map(normalizeGrantFindingV2);
    return clone([...v2, ...v3ByFindingId.values(), ...hierarchicalByFindingId.values()]);
  }
}
