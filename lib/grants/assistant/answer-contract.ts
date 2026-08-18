import { z } from "zod";
import type {
  GrantAssistantAdmittedContext,
  GrantAssistantGroundedCitation,
  GrantAssistantGroundedClaim,
} from "../ports/grant-assistant-model.ts";

const ContextReferenceSchema = z.object({
  sourceAlias: z.string(),
  sourceType: z.enum(["document_selection", "edit_candidate", "evidence", "academic_source"]),
  label: z.string(),
}).strict();
const ClaimSchema = z.object({ claimId: z.string(), statement: z.string(), citationIds: z.array(z.string()) }).strict();
const CitationSchema = ContextReferenceSchema.extend({ citationId: z.string(), excerpt: z.string().optional() }).strict();

export type GrantAssistantContextReference = Pick<
  GrantAssistantAdmittedContext,
  "sourceAlias" | "sourceType" | "label"
>;

export type GrantAssistantUnsupportedClaim = {
  statement: string;
  reason: "missing_citation" | "invalid_citation_binding";
};

export type GrantAssistantSafetyWarning = {
  code: "unsupported_claim";
  message: string;
};

type GrantAssistantAnswerBase = {
  content: string;
  referencedObjects: GrantAssistantContextReference[];
  /** Reserved for later deterministic, user-confirmed action suggestions. */
  suggestedActions: [];
};

export type GrantAssistantGeneralReasoningAnswer = GrantAssistantAnswerBase & {
  grounding: "general_reasoning";
  claims: [];
  citations: [];
};

export type GrantAssistantEvidenceGroundedAnswer = GrantAssistantAnswerBase & {
  grounding: "evidence_grounded";
  claims: GrantAssistantGroundedClaim[];
  citations: Array<GrantAssistantGroundedCitation & GrantAssistantContextReference>;
  unsupportedClaims: GrantAssistantUnsupportedClaim[];
  warnings: GrantAssistantSafetyWarning[];
};

export type GrantAssistantAnswer =
  | GrantAssistantGeneralReasoningAnswer
  | GrantAssistantEvidenceGroundedAnswer;

export const GrantAssistantAnswerSchema = z.discriminatedUnion("grounding", [
  z.object({
    content: z.string().min(1), grounding: z.literal("general_reasoning"), claims: z.tuple([]), citations: z.tuple([]),
    referencedObjects: z.array(ContextReferenceSchema), suggestedActions: z.tuple([]),
  }).strict(),
  z.object({
    content: z.string().min(1), grounding: z.literal("evidence_grounded"), claims: z.array(ClaimSchema), citations: z.array(CitationSchema),
    referencedObjects: z.array(ContextReferenceSchema),
    unsupportedClaims: z.array(z.object({ statement: z.string(), reason: z.enum(["missing_citation", "invalid_citation_binding"]) }).strict()),
    warnings: z.array(z.object({ code: z.literal("unsupported_claim"), message: z.string() }).strict()),
    suggestedActions: z.tuple([]),
  }).strict(),
]);
