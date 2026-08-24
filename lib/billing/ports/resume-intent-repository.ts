import type { ResumeIntent, ResumeIntentContext, ResumeIntentStatus } from "../domain/resume-intents.ts";
import type { RegisteredAiOperation } from "../../ai/operation-registry.ts";

export interface ResumeIntentRepository {
  create(input: { resumeIntentId: string; ownerId: string; operation: RegisteredAiOperation; requiredPoints: number; context: ResumeIntentContext; createdAt: string; expiresAt: string }): Promise<ResumeIntent>;
  get(input: { resumeIntentId: string; ownerId: string }): Promise<ResumeIntent | null>;
  transition(input: { resumeIntentId: string; ownerId: string; from: ResumeIntentStatus[]; to: ResumeIntentStatus; now: string }): Promise<ResumeIntent>;
}
