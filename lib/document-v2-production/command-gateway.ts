import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentTextExecutionProfile } from "@/lib/document-v2/runtime/contracts";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { DocumentV2JobService } from "@/lib/document-v2/runtime/job-service";
import {
  dispatchDocumentV2Worker,
  logDocumentV2DispatchFailure,
  recordDocumentV2DispatchFailure,
} from "./dispatch";
import { launchDocumentResearchExplorationShadow } from "@/lib/research-exploration-production/shadow-launcher";

export type CreateDocumentCommand = {
  type: "create_document";
  ownerId: string;
  instruction: string;
  previousAssistantContent?: string;
  textExecution: DocumentTextExecutionProfile;
  language?: "zh" | "en";
  requestUrl: string;
};

export type DocumentCommandResult = {
  type: "document_job_created";
  jobId: string;
};

function createIntakeOnlyService(repository: SupabaseDocumentJobRepository) {
  return new DocumentV2JobService(
    repository,
    {
      generator: {
        async generate() {
          throw new Error("Command intake does not execute components.");
        },
      },
      validator: {
        async validate() {
          return { accepted: true };
        },
      },
    },
    {
      async renderAndStore() {
        throw new Error("Command intake does not render documents.");
      },
      async validateArtifact() {
        throw new Error("Command intake does not validate artifacts.");
      },
    },
  );
}

export async function executeDocumentCommand(input: {
  command: CreateDocumentCommand;
  supabase: SupabaseClient;
}): Promise<DocumentCommandResult> {
  const { command } = input;
  const previousContent = command.previousAssistantContent?.trim() ?? "";
  const instruction = [
    command.instruction,
    previousContent
      ? "以下是本次请求承接的上一轮助手内容。请将它作为待完善的内容来源，而不是直接复制聊天文本："
      : "",
    previousContent.slice(0, 6_000),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8_000);
  const jobId = randomUUID();
  const repository = new SupabaseDocumentJobRepository(
    input.supabase,
    command.ownerId,
  );
  const service = createIntakeOnlyService(repository);
  await service.createIntake({
    ownerId: command.ownerId,
    jobId,
    instruction,
    source: {
      kind: previousContent ? "previous_message" : "prompt",
      sourceIds: previousContent ? ["previous-assistant-message"] : [],
    },
    textExecution: command.textExecution,
  });
  try {
    await dispatchDocumentV2Worker({
      cause: "job_created",
      requestUrl: command.requestUrl,
      jobId,
    });
  } catch (dispatchError) {
    logDocumentV2DispatchFailure({
      cause: "job_created",
      jobId,
      error: dispatchError,
    });
    await recordDocumentV2DispatchFailure({
      repository,
      cause: "job_created",
      jobId,
      error: dispatchError,
    });
  }
  after(async () => {
    await launchDocumentResearchExplorationShadow({
      ownerId: command.ownerId,
      jobId,
      instruction,
      language: command.language,
    });
  });
  return { type: "document_job_created", jobId };
}
