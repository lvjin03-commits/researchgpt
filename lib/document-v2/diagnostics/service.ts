import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentJobDiagnostics } from "./contracts";
import { projectDocumentJobDiagnostics } from "./projector";
import {
  findOwnedDiagnosticJob,
  readDocumentDiagnosticSources,
} from "./repository";

export async function getDocumentJobDiagnostics(input: {
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
  jobId: string;
  now?: Date;
}): Promise<DocumentJobDiagnostics | null> {
  const ownedJob = await findOwnedDiagnosticJob(
    input.userClient,
    input.jobId,
  );
  if (!ownedJob) return null;
  const sources = await readDocumentDiagnosticSources({
    userClient: input.userClient,
    adminClient: input.adminClient,
    ownedJob,
  });
  return projectDocumentJobDiagnostics(sources, input.now);
}

