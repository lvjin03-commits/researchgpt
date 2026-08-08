import { randomUUID } from "node:crypto";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantChecker, GrantCheckerFindingCandidate } from "./checker.ts";
import {
  GrantDiagnosticConflictSchema,
  GrantFindingSchema,
  type GrantDiagnosticConflict,
  type GrantFinding,
} from "./contracts.ts";
import { createGrantSourceAnchor } from "./anchors.ts";

type CandidateWithRun = {
  runId: string;
  checker: GrantChecker;
  candidate: GrantCheckerFindingCandidate;
};

export function assembleGrantDiagnostics(input: {
  documentId: string;
  sourceRevisionId: string;
  snapshot: CanonicalGrantSnapshot;
  candidates: CandidateWithRun[];
  createId?: () => string;
  now?: () => string;
}): { findings: GrantFinding[]; conflicts: GrantDiagnosticConflict[] } {
  const createId = input.createId ?? randomUUID;
  const timestamp = (input.now ?? (() => new Date().toISOString()))();
  const findings = input.candidates.map(({ runId, checker, candidate }) => GrantFindingSchema.parse({
    findingId: createId(),
    runId,
    documentId: input.documentId,
    sourceRevisionId: input.sourceRevisionId,
    checkerId: checker.checkerId,
    checkerVersion: checker.checkerVersion,
    fingerprint: sha256Canonical({
      checkerId: checker.checkerId,
      checkerVersion: checker.checkerVersion,
      code: candidate.code,
      subjectKey: candidate.subjectKey,
      sourceRevisionId: input.sourceRevisionId,
    }),
    code: candidate.code,
    message: candidate.message,
    recommendation: candidate.recommendation,
    assessment: candidate.assessment,
    sourceAnchor: createGrantSourceAnchor({
      snapshot: input.snapshot,
      sourceRevisionId: input.sourceRevisionId,
      sectionId: candidate.sectionId,
      nodeId: candidate.nodeId,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
    }),
    lifecycleStatus: "open",
    createdAt: timestamp,
  }));
  const bySubject = new Map<string, CandidateWithRun[]>();
  input.candidates.forEach((item) => bySubject.set(item.candidate.subjectKey, [...(bySubject.get(item.candidate.subjectKey) ?? []), item]));
  const conflicts: GrantDiagnosticConflict[] = [];
  for (const [subjectKey, group] of bySubject) {
    if (new Set(group.map((item) => item.candidate.conclusion)).size < 2) continue;
    const findingIds = group.map((item) => findings[input.candidates.indexOf(item)]!.findingId);
    conflicts.push(GrantDiagnosticConflictSchema.parse({
      conflictId: createId(),
      documentId: input.documentId,
      sourceRevisionId: input.sourceRevisionId,
      subjectFingerprint: sha256Canonical({ sourceRevisionId: input.sourceRevisionId, subjectKey }),
      findingIds,
      conflictKind: "checker_disagreement",
      details: { subjectKey, conclusions: group.map((item) => ({ checkerId: item.checker.checkerId, conclusion: item.candidate.conclusion })) },
      createdAt: timestamp,
    }));
  }
  return { findings, conflicts };
}
