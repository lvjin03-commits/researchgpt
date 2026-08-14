import { GrantModelCallAttemptSchema, type GrantModelCallAttempt } from "../../model-execution/contracts.ts";
import type { GrantModelCallRepository } from "../../ports/grant-model-call-repository.ts";

export class InMemoryGrantModelCallRepository implements GrantModelCallRepository {
  private readonly attempts = new Map<string, GrantModelCallAttempt>();

  async start(attempt: GrantModelCallAttempt) {
    if (this.attempts.has(attempt.callId)) throw new Error("Grant model call already exists.");
    const parsed = GrantModelCallAttemptSchema.parse(attempt);
    this.attempts.set(parsed.callId, structuredClone(parsed));
    return structuredClone(parsed);
  }

  async finish(input: Parameters<GrantModelCallRepository["finish"]>[0]) {
    const current = this.attempts.get(input.callId);
    if (!current || current.status !== input.expectedStatus) throw new Error("Grant model call status changed.");
    const { expectedStatus: _expectedStatus, ...completion } = input;
    const next = GrantModelCallAttemptSchema.parse({ ...current, ...completion });
    this.attempts.set(next.callId, structuredClone(next));
    return structuredClone(next);
  }

  async listByTrace(documentId: string, traceId: string) {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.documentId === documentId && attempt.traceId === traceId)
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
      .map((attempt) => structuredClone(attempt));
  }
}
