import { randomUUID } from "node:crypto";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { GrantDiagnosticRunSchema, type GrantAnchorResolution, type GrantDiagnosticInputMode, type GrantDiagnosticRun } from "../diagnostics/contracts.ts";
import type { GrantChecker, GrantCheckerFindingCandidate } from "../diagnostics/checker.ts";
import { assembleGrantDiagnostics } from "../diagnostics/assembler.ts";
import { resolveGrantSourceAnchor } from "../diagnostics/anchors.ts";
import { analyzeGrantDiagnosticImpact } from "../diagnostics/impact-analyzer.ts";
import type { GrantDiagnosticExecution, GrantDiagnosticRepository } from "../ports/grant-diagnostic-repository.ts";
import { GrantRevisionService } from "./revision-service.ts";
import { GRANT_SEMANTIC_DIAGNOSTIC_CHECKER_ID } from "./semantic-diagnostic-checker.ts";

type DiagnosticServiceDependencies = {
  revisionService: GrantRevisionService;
  repository: GrantDiagnosticRepository;
  checkers: GrantChecker[];
  createId?: () => string;
  now?: () => string;
  incrementalEnabled?: boolean;
};

export type GrantRecheckSummary = {
  state: "not_run" | "resolved" | "stable" | "improving" | "regressed" | "changed";
  inputMode?: GrantDiagnosticInputMode;
  checkedSectionCount: number;
  checkedNodeCount: number;
  currentFindingCount: number;
  resolvedCount: number;
  introducedCount: number;
  reusedExecution: boolean;
};

export type GrantDiagnosticCoverage = {
  deterministic: "not_run" | "complete" | "partial";
  semantic: "not_run" | "complete" | "failed";
  failedCheckerIds: string[];
  semanticModelId?: string;
};

function stableFindingKey(checker: GrantChecker, candidate: GrantCheckerFindingCandidate): string {
  return sha256Canonical({
    checkerId: checker.checkerId,
    checkerVersion: checker.checkerVersion,
    code: candidate.code,
    subjectKey: candidate.subjectKey,
  });
}

function findingKeys(run?: GrantDiagnosticRun): string[] {
  const value = run?.parsedOutput.stableFindingKeys;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function scopedFindingKeys(run: GrantDiagnosticRun | undefined, sectionIds: ReadonlySet<string>): string[] {
  const subjects = run?.parsedOutput.stableFindingSubjects;
  if (!Array.isArray(subjects)) return findingKeys(run);
  return subjects.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const key = "key" in item && typeof item.key === "string" ? item.key : undefined;
    const sectionId = "sectionId" in item && typeof item.sectionId === "string" ? item.sectionId : undefined;
    return key && (!sectionId || sectionIds.has(sectionId)) ? [key] : [];
  });
}

function latestByChecker(runs: GrantDiagnosticRun[]): Map<string, GrantDiagnosticRun> {
  const result = new Map<string, GrantDiagnosticRun>();
  for (const run of [...runs].sort((a, b) => b.completedAt.localeCompare(a.completedAt))) {
    if (!result.has(run.checkerId)) result.set(run.checkerId, run);
  }
  return result;
}

export class GrantDiagnosticService {
  private readonly revisionService: GrantRevisionService;
  private readonly repository: GrantDiagnosticRepository;
  private readonly checkers: GrantChecker[];
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly incrementalEnabled: boolean;

  constructor({ revisionService, repository, checkers, createId = randomUUID, now = () => new Date().toISOString(), incrementalEnabled = false }: DiagnosticServiceDependencies) {
    this.revisionService = revisionService;
    this.repository = repository;
    this.checkers = checkers;
    this.createId = createId;
    this.now = now;
    this.incrementalEnabled = incrementalEnabled;
  }

  async run(documentId: string, actorId: string, options: { incremental?: boolean } = {}): Promise<GrantDiagnosticExecution & { recheck: GrantRecheckSummary }> {
    const aggregate = await this.revisionService.getDocument(documentId);
    const sourceRevision = aggregate.currentRevision;
    const priorRevision = sourceRevision.parentRevisionId
      ? await this.revisionService.getRevision(documentId, sourceRevision.parentRevisionId)
      : undefined;
    const impact = priorRevision ? analyzeGrantDiagnosticImpact(sourceRevision.snapshot, priorRevision.snapshot) : undefined;
    const impactedSectionIds = impact?.sectionIds ?? [];
    const useIncremental = this.incrementalEnabled && options.incremental === true && Boolean(priorRevision)
      && impactedSectionIds.length > 0
      && (impact?.coverageRatio ?? 1) <= 0.6
      && this.checkers.every((checker) => checker.supportedInputModes?.includes("section_bundle"));
    const inputMode: GrantDiagnosticInputMode = useIncremental ? "section_bundle" : "full_document";
    const inputSectionIds = useIncremental ? impactedSectionIds : sourceRevision.snapshot.sections.map((section) => section.sectionId);
    const inputSectionSet = new Set(inputSectionIds);
    const inputNodeIds = sourceRevision.snapshot.nodes.filter((node) => inputSectionSet.has(node.sectionId)).map((node) => node.nodeId);
    const existingRuns = this.incrementalEnabled && this.repository.listRuns ? await this.repository.listRuns(documentId) : [];
    const candidates: Array<{ runId: string; checker: GrantChecker; candidate: GrantCheckerFindingCandidate }> = [];
    const runs: GrantDiagnosticRun[] = [];
    let reusedExecution = true;

    for (const checker of this.checkers) {
      const inputHash = sha256Canonical({
        checkerId: checker.checkerId,
        checkerVersion: checker.checkerVersion,
        contractVersion: checker.contractVersion,
        configurationFingerprint: checker.configurationFingerprint ?? "deterministic",
        inputMode,
        inputSectionIds,
        inputNodeIds,
        sourceRevisionId: sourceRevision.revisionId,
        contentHash: sourceRevision.contentHash,
      });
      const reusable = existingRuns.find((run) => run.checkerId === checker.checkerId && run.inputHash === inputHash && run.status === "succeeded");
      if (reusable) {
        runs.push(reusable);
        continue;
      }
      reusedExecution = false;
      const runId = this.createId();
      const startedAt = this.now();
      try {
        const output = await checker.check({
          executionId: runId,
          documentId,
          revisionId: sourceRevision.revisionId,
          snapshot: sourceRevision.snapshot,
          inputMode,
          inputNodeIds,
          inputSectionIds,
        });
        output.findings.forEach((candidate) => candidates.push({ runId, checker, candidate }));
        runs.push(GrantDiagnosticRunSchema.parse({
          runId,
          documentId,
          sourceRevisionId: sourceRevision.revisionId,
          checkerId: checker.checkerId,
          checkerVersion: checker.checkerVersion,
          contractVersion: checker.contractVersion,
          inputMode,
          inputNodeIds,
          inputHash,
          status: "succeeded",
          parsedOutput: {
            findingCount: output.findings.length,
            stableFindingKeys: output.findings.map((candidate) => stableFindingKey(checker, candidate)),
            stableFindingSubjects: output.findings.map((candidate) => ({ key: stableFindingKey(checker, candidate), sectionId: candidate.sectionId })),
            inputSectionIds,
            metadata: output.metadata ?? {},
          },
          createdBy: actorId,
          startedAt,
          completedAt: this.now(),
        }));
      } catch (error) {
        runs.push(GrantDiagnosticRunSchema.parse({
          runId,
          documentId,
          sourceRevisionId: sourceRevision.revisionId,
          checkerId: checker.checkerId,
          checkerVersion: checker.checkerVersion,
          contractVersion: checker.contractVersion,
          inputMode,
          inputNodeIds,
          inputHash,
          status: "failed",
          parsedOutput: { inputSectionIds },
          failureCode: error instanceof Error ? error.name : "checker_failed",
          createdBy: actorId,
          startedAt,
          completedAt: this.now(),
        }));
      }
    }

    if (reusedExecution) {
      const allFindings = await this.repository.listFindings(documentId);
      const runIds = new Set(runs.map((run) => run.runId));
      const findings = allFindings.filter((finding) => runIds.has(finding.runId));
      const allConflicts = await this.repository.listConflicts(documentId);
      const findingIds = new Set(findings.map((finding) => finding.findingId));
      const conflicts = allConflicts.filter((conflict) => conflict.findingIds.every((findingId) => findingIds.has(findingId)));
      return { runs, findings, conflicts, recheck: this.summarize(runs, existingRuns, inputSectionIds.length, inputNodeIds.length, true) };
    }

    const assembled = assembleGrantDiagnostics({
      documentId,
      sourceRevisionId: sourceRevision.revisionId,
      snapshot: sourceRevision.snapshot,
      candidates,
      createId: this.createId,
      now: this.now,
    });
    const execution = await this.repository.saveExecution({ runs, ...assembled });
    return { ...execution, recheck: this.summarize(runs, existingRuns, inputSectionIds.length, inputNodeIds.length, false) };
  }

  async list(documentId: string, targetRevisionId?: string): Promise<{
    findings: Array<{ finding: Awaited<ReturnType<GrantDiagnosticRepository["listFindings"]>>[number]; resolution: GrantAnchorResolution }>;
    conflicts: Awaited<ReturnType<GrantDiagnosticRepository["listConflicts"]>>;
    recheck: GrantRecheckSummary;
    coverage: GrantDiagnosticCoverage;
  }> {
    const aggregate = await this.revisionService.getDocument(documentId);
    const targetRevision = targetRevisionId
      ? await this.revisionService.getRevision(documentId, targetRevisionId)
      : aggregate.currentRevision;
    const [allFindings, allConflicts, allRuns] = await Promise.all([
      this.repository.listFindings(documentId),
      this.repository.listConflicts(documentId),
      this.repository.listRuns ? this.repository.listRuns(documentId) : Promise.resolve([]),
    ]);
    const coverage = this.coverage(allRuns, targetRevision.revisionId);
    if (!this.incrementalEnabled || allRuns.length === 0) {
      return {
        findings: allFindings.map((finding) => ({ finding, resolution: resolveGrantSourceAnchor(finding.sourceAnchor, targetRevision.revisionId, targetRevision.snapshot) })),
        conflicts: allConflicts,
        recheck: { state: "not_run", checkedSectionCount: 0, checkedNodeCount: 0, currentFindingCount: allFindings.length, resolvedCount: 0, introducedCount: 0, reusedExecution: false },
        coverage,
      };
    }
    const runsForTarget = allRuns.filter((run) => run.status === "succeeded" && run.sourceRevisionId === targetRevision.revisionId);
    const successfulRuns = allRuns.filter((run) => run.status === "succeeded");
    const latestRuns = latestByChecker(runsForTarget.length > 0 ? runsForTarget : successfulRuns);
    const currentRunIds = new Set([...latestRuns.values()].map((run) => run.runId));
    const projectedFindings = [] as typeof allFindings;
    for (const [checkerId, latestRun] of latestRuns) {
      projectedFindings.push(...allFindings.filter((finding) => finding.runId === latestRun.runId));
      if (latestRun.inputMode !== "section_bundle") continue;
      const impacted = new Set(Array.isArray(latestRun.parsedOutput.inputSectionIds)
        ? latestRun.parsedOutput.inputSectionIds.filter((id): id is string => typeof id === "string")
        : []);
      const previousRun = [...successfulRuns]
        .filter((run) => run.checkerId === checkerId && run.runId !== latestRun.runId)
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
      if (!previousRun) continue;
      const previousUnchanged = allFindings.filter((finding) =>
        finding.runId === previousRun.runId
        && (!finding.sourceAnchor.sectionId || !impacted.has(finding.sourceAnchor.sectionId))
      );
      projectedFindings.push(...previousUnchanged);
    }
    const findings = [...new Map(projectedFindings.map((finding) => [finding.findingId, finding])).values()];
    const findingIds = new Set(findings.map((finding) => finding.findingId));
    const conflicts = allConflicts.filter((conflict) => conflict.findingIds.every((findingId) => findingIds.has(findingId)));
    const currentRuns = [...latestRuns.values()];
    const previousRuns = successfulRuns.filter((run) => !currentRunIds.has(run.runId));
    const sectionIds = new Set(currentRuns.flatMap((run) => Array.isArray(run.parsedOutput.inputSectionIds) ? run.parsedOutput.inputSectionIds.filter((id): id is string => typeof id === "string") : []));
    return {
      findings: findings.map((finding) => ({
        finding,
        resolution: resolveGrantSourceAnchor(finding.sourceAnchor, targetRevision.revisionId, targetRevision.snapshot),
      })),
      conflicts,
      recheck: this.summarize(currentRuns, previousRuns, sectionIds.size, new Set(currentRuns.flatMap((run) => run.inputNodeIds)).size, false),
      coverage,
    };
  }

  private coverage(runs: GrantDiagnosticRun[], revisionId: string): GrantDiagnosticCoverage {
    const latest = latestByChecker(runs.filter((run) => run.sourceRevisionId === revisionId));
    const semanticCheckerId = GRANT_SEMANTIC_DIAGNOSTIC_CHECKER_ID;
    const semanticRun = latest.get(semanticCheckerId);
    const deterministicCheckers = this.checkers.filter((checker) => checker.checkerId !== semanticCheckerId);
    const deterministicSucceeded = deterministicCheckers.filter((checker) => latest.get(checker.checkerId)?.status === "succeeded").length;
    const failedCheckerIds = [...latest.values()].filter((run) => run.status === "failed").map((run) => run.checkerId);
    const semanticMetadata = semanticRun?.parsedOutput.metadata;
    return {
      deterministic: deterministicSucceeded === 0
        ? "not_run"
        : deterministicSucceeded === deterministicCheckers.length ? "complete" : "partial",
      semantic: !semanticRun ? "not_run" : semanticRun.status === "succeeded" ? "complete" : "failed",
      failedCheckerIds,
      semanticModelId: semanticMetadata && typeof semanticMetadata === "object" && "modelId" in semanticMetadata && typeof semanticMetadata.modelId === "string"
        ? semanticMetadata.modelId
        : undefined,
    };
  }

  private summarize(currentRuns: GrantDiagnosticRun[], previousRuns: GrantDiagnosticRun[], checkedSectionCount: number, checkedNodeCount: number, reusedExecution: boolean): GrantRecheckSummary {
    if (currentRuns.length === 0) {
      return { state: "not_run", checkedSectionCount: 0, checkedNodeCount: 0, currentFindingCount: 0, resolvedCount: 0, introducedCount: 0, reusedExecution };
    }
    const previousByChecker = latestByChecker(previousRuns.filter((run) => run.status === "succeeded"));
    const scopeSectionIds = new Set(currentRuns.flatMap((run) => Array.isArray(run.parsedOutput.inputSectionIds)
      ? run.parsedOutput.inputSectionIds.filter((id): id is string => typeof id === "string")
      : []));
    const currentKeys = new Set(currentRuns.flatMap(findingKeys));
    const previousKeys = new Set([...previousByChecker.values()].flatMap((run) => scopedFindingKeys(run, scopeSectionIds)));
    const resolvedCount = [...previousKeys].filter((key) => !currentKeys.has(key)).length;
    const introducedCount = [...currentKeys].filter((key) => !previousKeys.has(key)).length;
    let state: GrantRecheckSummary["state"] = "changed";
    if (currentKeys.size === 0) state = "resolved";
    else if (previousKeys.size > 0 && resolvedCount === 0 && introducedCount === 0) state = "stable";
    else if (resolvedCount > introducedCount) state = "improving";
    else if (introducedCount > resolvedCount) state = "regressed";
    return {
      state,
      inputMode: currentRuns[0]?.inputMode,
      checkedSectionCount,
      checkedNodeCount,
      currentFindingCount: currentKeys.size,
      resolvedCount,
      introducedCount,
      reusedExecution,
    };
  }
}
