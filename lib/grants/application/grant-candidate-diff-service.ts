import type { GrantAiEditSessionRepository } from "../ports/grant-ai-edit-session-repository.ts";
import { prepareGrantCandidateAnalysis } from "../edit-session/candidate-analysis.ts";
import type { GrantRevisionService } from "./revision-service.ts";

export class GrantCandidateDiffError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GrantCandidateDiffError";
  }
}

export class GrantCandidateDiffService {
  constructor(private readonly dependencies: { repository: GrantAiEditSessionRepository; revisionService: Pick<GrantRevisionService, "getRevision"> }) {}

  async getDiff(input: { documentId: string; sessionId: string; candidateId: string }) {
    const analysis = await prepareGrantCandidateAnalysis(
      input,
      this.dependencies,
      (code, message) => new GrantCandidateDiffError(code, message),
    );
    return { candidateId: analysis.candidate.candidateId, safetyState: analysis.candidate.safetyState, diff: analysis.diff, blockingIssues: analysis.blockingIssues };
  }
}
