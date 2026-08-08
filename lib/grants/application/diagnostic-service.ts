import { randomUUID } from "node:crypto";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { GrantDiagnosticRunSchema, type GrantAnchorResolution } from "../diagnostics/contracts.ts";
import type { GrantChecker, GrantCheckerFindingCandidate } from "../diagnostics/checker.ts";
import { assembleGrantDiagnostics } from "../diagnostics/assembler.ts";
import { resolveGrantSourceAnchor } from "../diagnostics/anchors.ts";
import type { GrantDiagnosticExecution, GrantDiagnosticRepository } from "../ports/grant-diagnostic-repository.ts";
import { GrantRevisionService } from "./revision-service.ts";

type DiagnosticServiceDependencies = {
  revisionService: GrantRevisionService;
  repository: GrantDiagnosticRepository;
  checkers: GrantChecker[];
  createId?: () => string;
  now?: () => string;
};

export class GrantDiagnosticService {
  private readonly revisionService: GrantRevisionService;
  private readonly repository: GrantDiagnosticRepository;
  private readonly checkers: GrantChecker[];
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor({ revisionService, repository, checkers, createId = randomUUID, now = () => new Date().toISOString() }: DiagnosticServiceDependencies) {
    this.revisionService = revisionService;
    this.repository = repository;
    this.checkers = checkers;
    this.createId = createId;
    this.now = now;
  }

  async run(documentId: string, actorId: string): Promise<GrantDiagnosticExecution> {
    const aggregate = await this.revisionService.getDocument(documentId);
    const sourceRevisionId = aggregate.currentRevision.revisionId;
    const snapshot = aggregate.currentRevision.snapshot;
    const inputNodeIds = snapshot.nodes.map((node) => node.nodeId);
    const candidates: Array<{ runId: string; checker: GrantChecker; candidate: GrantCheckerFindingCandidate }> = [];
    const runs = [];
    for (const checker of this.checkers) {
      const runId = this.createId();
      const startedAt = this.now();
      const inputHash = sha256Canonical({
        checkerId: checker.checkerId,
        checkerVersion: checker.checkerVersion,
        contractVersion: checker.contractVersion,
        inputMode: checker.inputMode,
        inputNodeIds,
        sourceRevisionId,
        contentHash: aggregate.currentRevision.contentHash,
      });
      try {
        const output = await checker.check({ documentId, revisionId: sourceRevisionId, snapshot, inputMode: checker.inputMode, inputNodeIds });
        output.findings.forEach((candidate) => candidates.push({ runId, checker, candidate }));
        runs.push(GrantDiagnosticRunSchema.parse({
          runId,
          documentId,
          sourceRevisionId,
          checkerId: checker.checkerId,
          checkerVersion: checker.checkerVersion,
          contractVersion: checker.contractVersion,
          inputMode: checker.inputMode,
          inputNodeIds,
          inputHash,
          status: "succeeded",
          parsedOutput: { findingCount: output.findings.length, metadata: output.metadata ?? {} },
          createdBy: actorId,
          startedAt,
          completedAt: this.now(),
        }));
      } catch (error) {
        runs.push(GrantDiagnosticRunSchema.parse({
          runId,
          documentId,
          sourceRevisionId,
          checkerId: checker.checkerId,
          checkerVersion: checker.checkerVersion,
          contractVersion: checker.contractVersion,
          inputMode: checker.inputMode,
          inputNodeIds,
          inputHash,
          status: "failed",
          parsedOutput: {},
          failureCode: error instanceof Error ? error.name : "checker_failed",
          createdBy: actorId,
          startedAt,
          completedAt: this.now(),
        }));
      }
    }
    const assembled = assembleGrantDiagnostics({
      documentId,
      sourceRevisionId,
      snapshot,
      candidates,
      createId: this.createId,
      now: this.now,
    });
    return this.repository.saveExecution({ runs, ...assembled });
  }

  async list(documentId: string, targetRevisionId?: string): Promise<{
    findings: Array<{ finding: Awaited<ReturnType<GrantDiagnosticRepository["listFindings"]>>[number]; resolution: GrantAnchorResolution }>;
    conflicts: Awaited<ReturnType<GrantDiagnosticRepository["listConflicts"]>>;
  }> {
    const aggregate = await this.revisionService.getDocument(documentId);
    const targetRevision = targetRevisionId
      ? await this.revisionService.getRevision(documentId, targetRevisionId)
      : aggregate.currentRevision;
    const findings = await this.repository.listFindings(documentId);
    const conflicts = await this.repository.listConflicts(documentId);
    return {
      findings: findings.map((finding) => ({
        finding,
        resolution: resolveGrantSourceAnchor(finding.sourceAnchor, targetRevision.revisionId, targetRevision.snapshot),
      })),
      conflicts,
    };
  }
}
