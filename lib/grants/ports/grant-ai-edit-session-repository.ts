import type { GrantAiEditCandidate, GrantAiEditSession, GrantAiEditTurn } from "../edit-session/contracts.ts";

export interface GrantAiEditSessionRepository {
  createSession(session: GrantAiEditSession): Promise<void>;
  getSession(sessionId: string): Promise<GrantAiEditSession | null>;
  createTurn(turn: GrantAiEditTurn): Promise<void>;
  completeTurnWithCandidate(input: { turnId: string; completedAt: string; candidate: GrantAiEditCandidate }): Promise<void>;
  failTurn(input: { turnId: string; completedAt: string; failureCategory: string }): Promise<void>;
  markSessionStale(sessionId: string, lastActiveAt: string): Promise<void>;
  markCandidateNeedsRepair(candidateId: string): Promise<void>;
  markSessionApplied(input: { sessionId: string; candidateId: string; proposalId: string; revisionId: string; lastActiveAt: string }): Promise<void>;
  listTurns(sessionId: string): Promise<GrantAiEditTurn[]>;
  listCandidates(sessionId: string): Promise<GrantAiEditCandidate[]>;
}
