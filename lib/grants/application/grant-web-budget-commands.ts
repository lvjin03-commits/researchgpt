import { z } from "zod";
import { authorizeResumableWebAnswerBudgetIncrease, waiveDecisionEnvelopeForDelivery,
  createResumableWebAnswerBudget, type ResumableWebAnswerBudgetState } from "../../billing/domain/resumable-web-answer-budget.ts";
import type { GrantWebResumableCheckpoint } from "../web-sources/resumable-checkpoint.ts";
import { GrantWebResumableCheckpointSchema } from "../web-sources/resumable-checkpoint.ts";
import { GrantWebResumableFlow } from "./grant-web-resumable-flow.ts";
import { assembleGrantWebGroundedAnswer } from "../web-sources/grounded-answer-assembler.ts";
import type { GrantAssistantAnswer } from "../assistant/answer-contract.ts";

export const GrantWebBudgetIncreaseCommandSchema = z.object({
  budgetId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(),
  authorizationId: z.string().uuid(), additionalPoints: z.number().int().positive(),
}).strict();
export const GrantWebDeliverExistingCommandSchema = z.object({
  budgetId: z.string().uuid(), expectedVersion: z.number().int().nonnegative(),
}).strict();
export const GrantWebAnswerStartSchema = z.object({
  budgetId: z.string().uuid(), authorizationId: z.string().uuid(), ownerId: z.string().uuid(),
  documentId: z.string().uuid(), turnId: z.string().uuid(), assistantSessionId: z.string().uuid(),
  question: z.string().trim().min(1).max(12000), authorizedPoints: z.number().int().min(20).max(500),
  sourceRevision: z.number().int().positive(), contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
  authorizationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export interface GrantWebBudgetCommandRepository {
  create(state: ResumableWebAnswerBudgetState,
    checkpoint: GrantWebResumableCheckpoint): Promise<ResumableWebAnswerBudgetState>;
  get(budgetId: string): Promise<{ state: ResumableWebAnswerBudgetState; checkpoint: unknown } | null>;
  getLatestPausedForDocument?(documentId: string): Promise<{
    state: ResumableWebAnswerBudgetState; checkpoint: unknown;
  } | null>;
  authorizeIncrease(previous: ResumableWebAnswerBudgetState, authorizationId: string,
    additionalPoints: number, next: ResumableWebAnswerBudgetState): Promise<ResumableWebAnswerBudgetState>;
  transition(previous: ResumableWebAnswerBudgetState,
    next: ResumableWebAnswerBudgetState): Promise<ResumableWebAnswerBudgetState>;
}

export type GrantWebContinuationStepResult =
  | { status: "awaiting_budget"; state: ResumableWebAnswerBudgetState;
      checkpoint: GrantWebResumableCheckpoint; requiredAdditionalPoints: number }
  | { status: "advanced"; state: ResumableWebAnswerBudgetState; checkpoint: GrantWebResumableCheckpoint }
  | { status: "completed"; state: ResumableWebAnswerBudgetState; checkpoint: GrantWebResumableCheckpoint; answer: unknown };

export interface GrantWebContinuationStepExecutor {
  execute(input: { operation: "query_rewrite" | "search_query" | "source_assessment" |
    "answer_synthesis" | "existing_results_delivery"; state: ResumableWebAnswerBudgetState;
    checkpoint: GrantWebResumableCheckpoint }): Promise<GrantWebContinuationStepResult>;
  getProtectedDeliveryMaximumPoints(): Promise<number>;
}

export type GrantWebCompletedDelivery = {
  checkpoint: GrantWebResumableCheckpoint;
  answer: GrantAssistantAnswer;
};

export class GrantWebBudgetCommandService {
  private readonly repository: GrantWebBudgetCommandRepository;
  private readonly flow: GrantWebResumableFlow;
  private readonly executor: GrantWebContinuationStepExecutor | null;
  private readonly onCompletedDelivery: ((delivery: GrantWebCompletedDelivery) => Promise<void>) | null;
  constructor(repository: GrantWebBudgetCommandRepository, flow = new GrantWebResumableFlow(),
    executor: GrantWebContinuationStepExecutor | null = null,
    onCompletedDelivery: ((delivery: GrantWebCompletedDelivery) => Promise<void>) | null = null) {
    this.repository = repository; this.flow = flow; this.executor = executor;
    this.onCompletedDelivery = onCompletedDelivery;
  }

  async getPaused(documentId: string) {
    const stored = await this.repository.getLatestPausedForDocument?.(documentId) ?? null;
    if (!stored) return null;
    const checkpoint = GrantWebResumableCheckpointSchema.parse(stored.checkpoint);
    return { budgetId: stored.state.budgetId, version: stored.state.version,
      requiredAdditionalPoints: stored.state.requiredAdditionalPoints!, settledPoints: stored.state.settledPoints,
      authorizedPoints: stored.state.authorizedPoints,
      turnId: checkpoint.turnId,
      question: checkpoint.question,
      canDeliverExisting: Boolean(checkpoint.search?.sources.length) };
  }

  async start(raw: unknown) {
    if (!this.executor) throw new Error("Grant web answer execution is not configured.");
    const input = GrantWebAnswerStartSchema.parse(raw);
    const deliveryHardMaximumPoints = await this.executor.getProtectedDeliveryMaximumPoints();
    if (input.authorizedPoints < deliveryHardMaximumPoints) {
      throw new Error(`Initial web budget must protect ${deliveryHardMaximumPoints} delivery points.`);
    }
    const state = createResumableWebAnswerBudget({ budgetId: input.budgetId, ownerId: input.ownerId,
      documentId: input.documentId, turnId: input.turnId, authorizationId: input.authorizationId,
      authorizedPoints: input.authorizedPoints, decisionHardMaximumPoints: 0, deliveryHardMaximumPoints });
    const checkpoint = GrantWebResumableCheckpointSchema.parse({ schemaVersion: 1,
      documentId: input.documentId, turnId: input.turnId, assistantSessionId: input.assistantSessionId,
      question: input.question, sourceRevision: input.sourceRevision, contextHash: input.contextHash,
      authorizationFingerprint: input.authorizationFingerprint,
      query: null, search: null, assessment: null, answer: null });
    const persisted = await this.repository.create(state, checkpoint);
    return this.withDelivery(await this.resume({ state: persisted, checkpoint, mode: "continue_research" }));
  }

  async increase(input: { state: ResumableWebAnswerBudgetState; command: unknown }) {
    const command = GrantWebBudgetIncreaseCommandSchema.parse(input.command);
    this.assertCurrent(input.state, command.budgetId, command.expectedVersion);
    const next = authorizeResumableWebAnswerBudgetIncrease({ state: input.state,
      authorizationId: command.authorizationId, additionalPoints: command.additionalPoints });
    return this.repository.authorizeIncrease(input.state, command.authorizationId, command.additionalPoints, next);
  }

  async increaseStored(input: { documentId: string; command: unknown }) {
    const command = GrantWebBudgetIncreaseCommandSchema.parse(input.command);
    const stored = await this.repository.get(command.budgetId);
    if (!stored || stored.state.documentId !== input.documentId) throw new Error("Grant web budget was not found.");
    const state = await this.increase({ state: stored.state, command });
    const checkpoint = stored.checkpoint == null ? null : GrantWebResumableCheckpointSchema.parse(stored.checkpoint);
    const continuation = checkpoint && this.executor
      ? await this.resume({ state, checkpoint, mode: "continue_research" }) : null;
    const resolved = continuation ? this.withDelivery(continuation) : null;
    await this.persistCompletedDelivery(resolved);
    return { state, continuation: resolved };
  }

  async deliverExisting(input: { state: ResumableWebAnswerBudgetState;
    checkpoint: GrantWebResumableCheckpoint; command: unknown }) {
    const command = GrantWebDeliverExistingCommandSchema.parse(input.command);
    this.assertCurrent(input.state, command.budgetId, command.expectedVersion);
    if (input.state.status !== "awaiting_budget") throw new Error("Existing-results delivery requires a paused budget.");
    const next = waiveDecisionEnvelopeForDelivery(input.state);
    const state = await this.repository.transition(input.state, next);
    return { state, nextOperation: this.flow.next({ checkpoint: input.checkpoint, deliverExisting: true }),
      sources: this.flow.deliverySources(input.checkpoint) };
  }

  async deliverExistingStored(input: { documentId: string; command: unknown }) {
    const command = GrantWebDeliverExistingCommandSchema.parse(input.command);
    const stored = await this.repository.get(command.budgetId);
    if (!stored || stored.state.documentId !== input.documentId || stored.checkpoint == null) {
      throw new Error("Grant web budget or checkpoint was not found.");
    }
    const prepared = await this.deliverExisting({ state: stored.state,
      checkpoint: GrantWebResumableCheckpointSchema.parse(stored.checkpoint), command });
    const continuation = this.executor ? await this.resume({ state: prepared.state,
      checkpoint: GrantWebResumableCheckpointSchema.parse(stored.checkpoint), mode: "deliver_existing" }) : null;
    const resolved = continuation ? this.withDelivery(continuation) : null;
    await this.persistCompletedDelivery(resolved);
    return { ...prepared, continuation: resolved };
  }

  private assertCurrent(state: ResumableWebAnswerBudgetState, budgetId: string, expectedVersion: number) {
    if (state.budgetId !== budgetId || state.version !== expectedVersion) throw new Error("Grant web budget command is stale.");
  }

  async resume(input: { state: ResumableWebAnswerBudgetState; checkpoint: GrantWebResumableCheckpoint;
    mode: "continue_research" | "deliver_existing" }): Promise<GrantWebContinuationStepResult> {
    if (!this.executor) throw new Error("Grant web answer execution is not configured.");
    let state = input.state;
    let checkpoint = GrantWebResumableCheckpointSchema.parse(input.checkpoint);
    for (let index = 0; index < 5; index += 1) {
      const operation = this.flow.next({ checkpoint, deliverExisting: input.mode === "deliver_existing" });
      if (operation === "complete") return { status: "completed", state, checkpoint, answer: checkpoint.answer };
      const result = await this.executor.execute({ operation, state, checkpoint });
      if (result.status !== "advanced") return result;
      state = result.state;
      checkpoint = GrantWebResumableCheckpointSchema.parse(result.checkpoint);
    }
    throw new Error("Grant web answer exceeded its bounded phase count.");
  }

  private withDelivery(result: GrantWebContinuationStepResult) {
    if (result.status !== "completed" || !result.checkpoint.search || !result.checkpoint.answer) return result;
    const assessment = result.checkpoint.assessment ?? { assessments: result.checkpoint.search.sources.map((source) => ({
      sourceId: source.sourceId, disposition: "recommended" as const, reason: "Available saved result",
    })) };
    return { ...result, delivery: assembleGrantWebGroundedAnswer({ sources: result.checkpoint.search.sources,
      assessmentProposal: assessment, answerProposal: result.checkpoint.answer }) };
  }

  private async persistCompletedDelivery(result: ReturnType<GrantWebBudgetCommandService["withDelivery"]> | null) {
    if (!result || !("delivery" in result) || !this.onCompletedDelivery) return;
    await this.onCompletedDelivery({ checkpoint: result.checkpoint, answer: result.delivery.answer });
  }
}
