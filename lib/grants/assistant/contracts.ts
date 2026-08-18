import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const GrantAssistantDocumentSelectionContextSchema = z.object({
  kind: z.literal("document_selection"),
  contextCardId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  sectionId: UuidSchema,
  nodeId: UuidSchema,
  nodeTextHash: Sha256Schema,
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().positive(),
  text: z.string().min(1),
  textHash: Sha256Schema,
  targetLabel: z.string().trim().min(1),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.endOffset <= value.startOffset) context.addIssue({ code: "custom", path: ["endOffset"], message: "Selection end must be after its start." });
  if (value.text.length !== value.endOffset - value.startOffset) context.addIssue({ code: "custom", path: ["text"], message: "Selection text must match the frozen offset span." });
});

export type GrantAssistantDocumentSelectionContext = z.infer<typeof GrantAssistantDocumentSelectionContextSchema>;

export const GrantAssistantCandidateContextSchema = z.object({
  kind: z.literal("edit_candidate"),
  editSessionId: UuidSchema,
  candidateId: UuidSchema,
  expectedCandidateHash: Sha256Schema,
  targetLabel: z.string().trim().min(1).max(240),
}).strict();

export type GrantAssistantCandidateContext = z.infer<typeof GrantAssistantCandidateContextSchema>;
