import type { GrantAiEditSessionRepository } from "../../ports/grant-ai-edit-session-repository.ts";
import type { GrantAiEditCandidate, GrantAiEditSession, GrantAiEditTurn } from "../../edit-session/contracts.ts";

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryGrantAiEditSessionRepository implements GrantAiEditSessionRepository {
  private sessions = new Map<string, GrantAiEditSession>();
  private turns = new Map<string, GrantAiEditTurn>();
  private candidates = new Map<string, GrantAiEditCandidate>();

  async createSession(session: GrantAiEditSession) { this.sessions.set(session.sessionId, clone(session)); }
  async getSession(sessionId: string) { const value = this.sessions.get(sessionId); return value ? clone(value) : null; }
  async createTurn(turn: GrantAiEditTurn) { this.turns.set(turn.turnId, clone(turn)); }
  async completeTurnWithCandidate(input: { turnId: string; completedAt: string; candidate: GrantAiEditCandidate }) {
    const turn = this.turns.get(input.turnId);
    const session = turn && this.sessions.get(turn.sessionId);
    if (!turn || !session || turn.status !== "running") throw new Error("Edit turn is not running.");
    this.candidates.set(input.candidate.candidateId, clone(input.candidate));
    this.turns.set(turn.turnId, { ...turn, status: "succeeded", completedAt: input.completedAt });
    this.sessions.set(session.sessionId, {
      ...session,
      activeCandidateId: input.candidate.candidateId,
      lastSafeCandidateId: input.candidate.safetyState === "passed" ? input.candidate.candidateId : session.lastSafeCandidateId,
      lastActiveAt: input.completedAt,
    });
  }
  async failTurn(input: { turnId: string; completedAt: string; failureCategory: string }) {
    const turn = this.turns.get(input.turnId);
    if (!turn || turn.status !== "running") throw new Error("Edit turn is not running.");
    this.turns.set(turn.turnId, { ...turn, status: "failed", failureCategory: input.failureCategory, completedAt: input.completedAt });
  }
  async markSessionStale(sessionId: string, lastActiveAt: string) {
    const session = this.sessions.get(sessionId);
    if (session) this.sessions.set(sessionId, { ...session, status: "stale", lastActiveAt });
  }
  async markCandidateNeedsRepair(candidateId: string) {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error("Edit candidate does not exist.");
    this.candidates.set(candidateId, {
      ...candidate,
      safetyState: "needs_repair",
      factCheck: { ...candidate.factCheck, state: "needs_repair" },
    });
  }
  async markSessionApplied(input: { sessionId: string; candidateId: string; proposalId: string; revisionId: string; lastActiveAt: string }) {
    const session = this.sessions.get(input.sessionId);
    if (!session) throw new Error("Edit session does not exist.");
    if (session.status === "applied") return;
    if (session.status !== "active" || session.activeCandidateId !== input.candidateId) throw new Error("Only the active Candidate of an active session may be applied.");
    this.sessions.set(input.sessionId, { ...session, status: "applied", appliedCandidateId: input.candidateId, appliedProposalId: input.proposalId, appliedRevisionId: input.revisionId, lastActiveAt: input.lastActiveAt });
  }
  async listTurns(sessionId: string) { return clone([...this.turns.values()].filter((value) => value.sessionId === sessionId)); }
  async listCandidates(sessionId: string) { return clone([...this.candidates.values()].filter((value) => value.sessionId === sessionId)); }
}
