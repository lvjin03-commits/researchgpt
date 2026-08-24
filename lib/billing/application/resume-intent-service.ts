import { randomUUID } from "node:crypto";
import { assertRegisteredAiOperation } from "../../ai/operation-registry.ts";
import { ResumeIntentContextSchema } from "../domain/resume-intents.ts";
import type { ResumeIntentRepository } from "../ports/resume-intent-repository.ts";

export interface ResumeIntentValidator {
  validate(input: { ownerId: string; operation: string; context: unknown }): Promise<{ valid: boolean }>;
}

export class ResumeIntentService {
  private readonly repository: ResumeIntentRepository;
  private readonly createId: () => string;
  private readonly now: () => Date;
  constructor(
    repository: ResumeIntentRepository,
    createId: () => string = randomUUID,
    now: () => Date = () => new Date(),
  ) { this.repository = repository; this.createId = createId; this.now = now; }

  create(input: { ownerId: string; operation: string; requiredPoints: number; context: unknown }) {
    const now = this.now();
    if (!Number.isSafeInteger(input.requiredPoints) || input.requiredPoints <= 0) throw new RangeError("requiredPoints must be positive.");
    return this.repository.create({
      resumeIntentId: this.createId(), ownerId: input.ownerId,
      operation: assertRegisteredAiOperation(input.operation),
      requiredPoints: input.requiredPoints,
      context: ResumeIntentContextSchema.parse(input.context),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    });
  }

  async revalidate(input: { resumeIntentId: string; ownerId: string; validator: ResumeIntentValidator }) {
    const intent = await this.repository.get(input);
    if (!intent || intent.status !== "needs_revalidation") throw new Error("resume_intent_not_revalidatable");
    const result = await input.validator.validate({ ownerId: input.ownerId, operation: intent.operation, context: intent.context });
    return this.repository.transition({
      ...input,
      from: ["needs_revalidation"],
      to: result.valid ? "ready" : "stale",
      now: this.now().toISOString(),
    });
  }

  consume(input: { resumeIntentId: string; ownerId: string }) {
    return this.repository.transition({ ...input, from: ["ready"], to: "consumed", now: this.now().toISOString() });
  }
}
