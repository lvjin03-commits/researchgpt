import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoTimestampSchema = z.string().datetime({ offset: true });

export const GrantPatchOperationSchema = z.object({
  type: z.literal("replace_text"),
  nodeId: UuidSchema,
  expectedTextHash: Sha256Schema,
  oldText: z.string(),
  newText: z.string().trim().min(1),
}).strict();

export const GrantPatchProposalSchema = z.object({
  proposalId: UuidSchema,
  documentId: UuidSchema,
  baseRevisionId: UuidSchema,
  findingId: UuidSchema.optional(),
  targetNodeIds: z.array(UuidSchema).length(1),
  instruction: z.string().trim().min(1).max(2000),
  operations: z.array(GrantPatchOperationSchema).length(1),
  status: z.enum(["pending", "accepted", "rejected", "invalidated", "evidence_revoked"]),
  createdBy: UuidSchema,
  modelProvider: z.enum(["deepseek", "openai"]),
  modelId: z.string().trim().min(1),
  rationale: z.string().trim().max(2000).optional(),
  acceptedRevisionId: UuidSchema.optional(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict().superRefine((proposal, context) => {
  const operation = proposal.operations[0];
  if (operation && operation.nodeId !== proposal.targetNodeIds[0]) {
    context.addIssue({ code: "custom", path: ["operations", 0, "nodeId"], message: "Patch operation exceeds the authorized target." });
  }
  if (operation && operation.oldText === operation.newText) {
    context.addIssue({ code: "custom", path: ["operations", 0, "newText"], message: "Patch must change visible text." });
  }
});

export type GrantPatchOperation = z.infer<typeof GrantPatchOperationSchema>;
export type GrantPatchProposal = z.infer<typeof GrantPatchProposalSchema>;
