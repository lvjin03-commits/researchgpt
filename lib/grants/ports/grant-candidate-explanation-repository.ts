import type { GrantCandidateExplanation } from "../edit-session/candidate-explanation.ts";

export type GrantCandidateExplanationClaim =
  | { state: "acquired" }
  | { state: "in_progress" }
  | { state: "completed"; traceId: string; explanation: GrantCandidateExplanation };

export interface GrantCandidateExplanationRepository {
  claim(input: {
    cacheKey: string;
    documentId: string;
    sessionId: string;
    candidateId: string;
    diffHash: string;
    traceId: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }): Promise<GrantCandidateExplanationClaim>;
  complete(input: { cacheKey: string; traceId: string; explanation: GrantCandidateExplanation; completedAt: string }): Promise<void>;
  fail(input: { cacheKey: string; traceId: string; failureCategory: string; failedAt: string }): Promise<void>;
}
