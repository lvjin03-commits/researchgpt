import { z } from "zod";
import { GrantWebAnswerProposalSchema, GrantWebQueryRewriteProposalSchema,
  GrantWebSourceAssessmentProposalSchema, GrantWebSourceRecordSchema } from "./contracts.ts";

const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const GrantWebResumableCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  documentId: z.string().uuid(),
  turnId: z.string().uuid(),
  assistantSessionId: z.string().uuid(),
  question: z.string().trim().min(1).max(12000),
  sourceRevision: z.number().int().positive(),
  contextHash: FingerprintSchema,
  authorizationFingerprint: FingerprintSchema,
  query: GrantWebQueryRewriteProposalSchema.nullable(),
  search: z.object({
    searchAuditId: z.string().uuid(),
    searchAuditIds: z.array(z.string().uuid()).min(1).max(5).optional(),
    sources: z.array(GrantWebSourceRecordSchema).max(25),
  }).strict().nullable(),
  assessment: GrantWebSourceAssessmentProposalSchema.nullable(),
  answer: GrantWebAnswerProposalSchema.nullable(),
}).strict();
export type GrantWebResumableCheckpoint = z.infer<typeof GrantWebResumableCheckpointSchema>;

export function revalidateGrantWebCheckpoint(input: {
  checkpoint: GrantWebResumableCheckpoint;
  sourceRevision: number;
  contextHash: string;
  authorizationFingerprint: string;
}): { checkpoint: GrantWebResumableCheckpoint; invalidated: Array<"assessment" | "answer"> } {
  const checkpoint = GrantWebResumableCheckpointSchema.parse(input.checkpoint);
  const documentRelativeChanged = checkpoint.sourceRevision !== input.sourceRevision
    || checkpoint.contextHash !== input.contextHash
    || checkpoint.authorizationFingerprint !== input.authorizationFingerprint;
  if (!documentRelativeChanged) return { checkpoint, invalidated: [] };
  return {
    checkpoint: GrantWebResumableCheckpointSchema.parse({ ...checkpoint,
      sourceRevision: input.sourceRevision, contextHash: input.contextHash,
      authorizationFingerprint: input.authorizationFingerprint,
      assessment: null, answer: null }),
    invalidated: ["assessment", "answer"],
  };
}

export function nextGrantWebCheckpointOperation(input: {
  checkpoint: GrantWebResumableCheckpoint;
  deliverExisting: boolean;
}): "query_rewrite" | "search_query" | "source_assessment" | "answer_synthesis" | "existing_results_delivery" | "complete" {
  const checkpoint = GrantWebResumableCheckpointSchema.parse(input.checkpoint);
  if (!checkpoint.query) return "query_rewrite";
  if (!checkpoint.search) return "search_query";
  if (input.deliverExisting) return checkpoint.answer ? "complete" : "existing_results_delivery";
  if (!checkpoint.assessment) return "source_assessment";
  if (!checkpoint.answer) return "answer_synthesis";
  return "complete";
}

export function deterministicGrantWebArtifactManifest(checkpointInput: GrantWebResumableCheckpoint) {
  const checkpoint = GrantWebResumableCheckpointSchema.parse(checkpointInput);
  return Object.freeze({
    searchedCount: checkpoint.search?.sources.length ?? 0,
    sourceFingerprints: Object.freeze((checkpoint.search?.sources ?? []).map((source) => source.contentFingerprint)),
    assessmentAvailable: checkpoint.assessment !== null,
    answerAvailable: checkpoint.answer !== null,
  });
}
