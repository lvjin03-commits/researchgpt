import type { GrantCandidateExplanation } from "../../edit-session/candidate-explanation.ts";
import type { GrantCandidateExplanationClaim, GrantCandidateExplanationRepository } from "../../ports/grant-candidate-explanation-repository.ts";

type Entry = {
  state: "running" | "completed" | "failed";
  traceId: string;
  leaseExpiresAt: string;
  explanation?: GrantCandidateExplanation;
};

export class InMemoryGrantCandidateExplanationRepository implements GrantCandidateExplanationRepository {
  private readonly entries = new Map<string, Entry>();

  async claim(input: Parameters<GrantCandidateExplanationRepository["claim"]>[0]): Promise<GrantCandidateExplanationClaim> {
    const existing = this.entries.get(input.cacheKey);
    if (existing?.state === "completed") return { state: "completed", traceId: existing.traceId, explanation: structuredClone(existing.explanation!) };
    if (existing?.state === "running" && Date.parse(existing.leaseExpiresAt) > Date.parse(input.claimedAt)) return { state: "in_progress" };
    this.entries.set(input.cacheKey, { state: "running", traceId: input.traceId, leaseExpiresAt: input.leaseExpiresAt });
    return { state: "acquired" };
  }

  async complete(input: Parameters<GrantCandidateExplanationRepository["complete"]>[0]) {
    const existing = this.entries.get(input.cacheKey);
    if (!existing || existing.state !== "running" || existing.traceId !== input.traceId) throw new Error("Candidate explanation cache lease changed.");
    this.entries.set(input.cacheKey, { ...existing, state: "completed", explanation: structuredClone(input.explanation) });
  }

  async fail(input: Parameters<GrantCandidateExplanationRepository["fail"]>[0]) {
    const existing = this.entries.get(input.cacheKey);
    if (existing?.state === "running" && existing.traceId === input.traceId) this.entries.set(input.cacheKey, { ...existing, state: "failed" });
  }
}
