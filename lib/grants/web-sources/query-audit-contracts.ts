import { z } from "zod";
import { GrantWebSearchEgressIssueSchema } from "./query-egress-policy.ts";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });

export const GrantWebSearchEgressAuditSchema = z.object({
  auditId: UuidSchema,
  documentId: UuidSchema,
  sourceRevision: z.number().int().positive(),
  actorId: UuidSchema,
  providerId: z.enum(["openalex", "google_custom_search"]),
  policyVersion: z.string().trim().min(1).max(100),
  decision: z.enum(["allowed", "blocked"]),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/u),
  outgoingQuery: z.string().trim().min(2).max(160).nullable(),
  issues: z.array(GrantWebSearchEgressIssueSchema).max(8),
  createdAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.decision === "allowed" && (value.outgoingQuery === null || value.issues.length > 0)) {
    context.addIssue({ code: "custom", message: "Allowed search audit must record the exact outgoing query and no issues." });
  }
  if (value.decision === "blocked" && (value.outgoingQuery !== null || value.issues.length === 0)) {
    context.addIssue({ code: "custom", message: "Blocked search audit stores no candidate text and must record an issue." });
  }
});

export type GrantWebSearchEgressAudit = z.infer<typeof GrantWebSearchEgressAuditSchema>;
