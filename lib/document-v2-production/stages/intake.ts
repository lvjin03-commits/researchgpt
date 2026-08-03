import { createHash, randomUUID } from "node:crypto";
import { DocumentJobSchema, type DocumentJob } from "@/lib/document-v2/runtime/contracts";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import type { DocumentStructuredTextExecutor } from "../text-executor";
import {
  ModelHierarchicalOutlinePlanner,
  DocumentClarificationNeededError,
  understandDocumentRequest,
} from "../planning";
import { resolveDocumentTemplate } from "@/lib/document-v2/templates/resolver";
import {
  assembleSemanticOutline,
  createDocumentPlanFromProposal,
  createValidatedSectionIndex,
  materializeDocumentStructure,
  materializeFigureIntents,
  materializeSectionPlan,
} from "@/lib/document-v2/planning/planner";
import { createImageExecutionProfile } from "@/lib/document-v2/assets/execution-policy";
import { createDocumentOrchestrationState } from "@/lib/document-v2/orchestration/orchestrator";
import { createReferenceExecutionProfile } from "@/lib/document-v2/references/contracts";
import {
  acquireDocumentReferences,
  createReferencePipelineFallback,
} from "@/lib/document-v2/references/acquisition";
import type { ResearchExplorationAdvisoryHints } from "@/lib/research-exploration/advisory/contracts";

export async function prepareIntake(input: {
  job: DocumentJob;
  repository: SupabaseDocumentJobRepository;
  textExecutor: DocumentStructuredTextExecutor;
  researchExplorationAdvisory?: ResearchExplorationAdvisoryHints;
}): Promise<DocumentJob> {
  const intake = input.job.checkpoint.intake;
  if (!intake) throw new Error("Document intake payload is missing.");
  let job = input.job;
  const saveAndContinue = async (
    planning: NonNullable<DocumentJob["checkpoint"]["planning"]>,
    progress: number,
  ) => {
    const now = new Date().toISOString();
    return input.repository.save(DocumentJobSchema.parse({
      ...job,
      status: "queued",
      stage: "planning",
      progress,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      checkpoint: { ...job.checkpoint, planning, savedAt: now },
      startedAt: job.startedAt ?? now,
      updatedAt: now,
    }), job.revision);
  };
  const logSaved = async (operation: string, message: string, metadata: Record<string, string | number | boolean | null>, componentKey?: string) => {
    await input.repository.appendEvent({
      eventId: randomUUID(), jobId: job.jobId, stage: "planning", status: "succeeded",
      message, category: operation === "outline.assemble" ? "validation" : "model",
      operation, correlationId: job.jobId, componentKey, metadata,
      createdAt: new Date().toISOString(),
    });
  };
  const planner = new ModelHierarchicalOutlinePlanner(input.textExecutor);
  let planning = job.checkpoint.planning;

  if (!planning) {
    const startedAt = new Date().toISOString();
    job = await input.repository.save(DocumentJobSchema.parse({
      ...job, status: "running", stage: "understanding", progress: 2,
      startedAt: job.startedAt ?? startedAt, updatedAt: startedAt,
    }), job.revision);
    await input.repository.appendEvent({
      eventId: randomUUID(), jobId: job.jobId, stage: "understanding", status: "started",
      message: "Understanding the document request.", category: "model",
      operation: "request.understand", correlationId: job.jobId,
      metadata: { provider: input.textExecutor.profile.provider, modelId: input.textExecutor.profile.resolvedModelId },
      createdAt: startedAt,
    });
    let request;
    try {
      request = await understandDocumentRequest(input.textExecutor, {
        idempotencyKey: job.jobId,
        instruction: intake.instruction,
        source: intake.source,
        language: intake.language,
        targetLength: intake.targetLength,
        verifiedReferences: intake.verifiedReferences,
      });
    } catch (error) {
      if (!(error instanceof DocumentClarificationNeededError)) throw error;
      const now = new Date().toISOString();
      job = await input.repository.save(DocumentJobSchema.parse({
        ...job,
        status: "awaiting_user_input",
        clarification: { questionId: randomUUID(), field: "topic_or_scope", question: error.question, reason: error.reason, required: true },
        leaseOwner: undefined, leaseExpiresAt: undefined,
        checkpoint: { ...job.checkpoint, savedAt: now }, updatedAt: now,
      }), job.revision);
      await input.repository.appendEvent({
        eventId: randomUUID(), jobId: job.jobId, stage: "understanding", status: "paused",
        message: error.question, category: "validation", operation: "request.clarification_required",
        correlationId: job.jobId, metadata: { reason: error.reason }, createdAt: now,
      });
      return job;
    }
    const template = await resolveDocumentTemplate({
      request,
      matcher: { async match({ candidates }) {
        const candidate = candidates[0];
        if (!candidate) throw new Error("No compatible document template is enabled.");
        return { templateId: candidate.templateId, confidence: 1, rationale: "Resolved deterministically from template intent and compatibility." };
      } },
    });
    const evidenceReferences = [...new Map([
      ...(intake.verifiedReferences ?? []),
      ...intake.evidence.map((item) => item.reference),
    ].map((reference) => [reference.id, reference])).values()];
    const evidenceSnapshotId = intake.evidence.length > 0
      ? `evidence-${createHash("sha256").update(JSON.stringify(intake.evidence)).digest("hex").slice(0, 24)}`
      : undefined;
    const referenceExecution = createReferenceExecutionProfile({
      requirement: request.userRequirements.citationRequirement,
      policy: request.userRequirements.referencePolicy,
      hasUserReferences:
        evidenceReferences.length > 0 || intake.evidence.length > 0,
      runtimeEnabled:
        process.env.DOCUMENT_V2_REFERENCE_PIPELINE_ENABLED !== "false",
    });
    const referenceResult = referenceExecution.enabled
      ? undefined
      : await acquireDocumentReferences({
          profile: referenceExecution,
          topic: request.userRequirements.topic ?? "",
          existingReferences: evidenceReferences,
          existingEvidence: intake.evidence,
        });
    planning = {
      schemaVersion: 1,
      request,
      template,
      evidenceReferences,
      evidenceSnapshotId,
      planningRevision: 1,
      figureIntentsCompleted: false,
      sectionPlans: [],
      planningInvalidations: [],
    };
    job = DocumentJobSchema.parse({
      ...job,
      checkpoint: {
        ...job.checkpoint,
        imageExecution: createImageExecutionProfile({
          visualIntent: request.userRequirements.visualIntent,
          frozenAt: new Date().toISOString(),
        }),
        referenceExecution,
        referenceResult,
      },
    });
    job = await saveAndContinue(planning, 5);
    await logSaved("planning.context.saved", "Document request, template, and evidence context were saved.", {
      templateId: template.snapshot.templateId, evidenceCount: evidenceReferences.length,
    });
    return job;
  }

  const sectionBlueprint = planning.template.componentBlueprints.find((item) => item.type === "section");
  if (!sectionBlueprint) throw new Error("Resolved template does not contain a section blueprint.");
  if (!planning.thesis) {
    const thesis = await planner.createThesis({
      request: planning.request,
      template: planning.template,
      planningRevision: planning.planningRevision,
      advisoryHints: input.researchExplorationAdvisory,
    });
    planning = { ...planning, thesis };
    job = await saveAndContinue(planning, 6);
    await logSaved("outline.thesis", "Document thesis and scope saved.", {
      planningRevision: planning.planningRevision,
    });
    return job;
  }

  if (!planning.skeleton) {
    const sectionIndex = await createValidatedSectionIndex({
      planner,
      request: planning.request,
      template: planning.template,
      thesis: planning.thesis,
      minimumSections: sectionBlueprint.minimumCount,
      maximumSections: sectionBlueprint.maximumCount,
      planningRevision: planning.planningRevision,
      advisoryHints: input.researchExplorationAdvisory,
    });
    const skeleton = materializeDocumentStructure({
      thesis: planning.thesis,
      sectionIndex,
    });
    planning = { ...planning, skeleton };
    job = await saveAndContinue(planning, 7);
    await logSaved("outline.section_index", "Document section index saved.", {
      sectionCount: skeleton.sections.length,
      planningRevision: planning.planningRevision,
    });
    return job;
  }

  const referenceExecution = job.checkpoint.referenceExecution;
  if (referenceExecution?.enabled && !job.checkpoint.referenceResult) {
    const acquisitionStartedAt = new Date().toISOString();
    job = await input.repository.save(
      DocumentJobSchema.parse({
        ...job,
        status: "running",
        stage: "evidence_acquisition",
        progress: 7,
        updatedAt: acquisitionStartedAt,
      }),
      job.revision,
    );
    await input.repository.appendEvent({
      eventId: randomUUID(),
      jobId: job.jobId,
      stage: "evidence_acquisition",
      status: "started",
      message: "正在获取并核验可用于正文引用的参考文献。",
      category: "lifecycle",
      operation: "references.acquire",
      correlationId: job.jobId,
      createdAt: acquisitionStartedAt,
    });
    let referenceResult;
    let referenceFailureMessage: string | undefined;
    try {
      referenceResult = await acquireDocumentReferences({
        profile: referenceExecution,
        topic:
          planning.request.userRequirements.referenceSearchQuery ??
          planning.request.userRequirements.topic ??
          "",
        existingReferences: planning.evidenceReferences,
        existingEvidence: intake.evidence,
      });
    } catch (error) {
      referenceFailureMessage =
        error instanceof Error ? error.message : String(error);
      referenceResult = createReferencePipelineFallback({
        existingReferences: planning.evidenceReferences,
        existingEvidence: intake.evidence,
      });
    }
    const evidenceReferences = referenceResult.verifiedReferences;
    const evidenceSnapshotId =
      referenceResult.evidence.length > 0
        ? `evidence-${createHash("sha256")
            .update(JSON.stringify(referenceResult.evidence))
            .digest("hex")
            .slice(0, 24)}`
        : planning.evidenceSnapshotId;
    planning = {
      ...planning,
      evidenceReferences,
      evidenceSnapshotId,
    };
    const savedAt = new Date().toISOString();
    job = await input.repository.save(
      DocumentJobSchema.parse({
        ...job,
        status: "queued",
        stage: "planning",
        progress: 7,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        referenceOutcome: referenceResult.outcome,
        referenceWarnings: referenceResult.warnings,
        checkpoint: {
          ...job.checkpoint,
          planning,
          referenceResult,
          savedAt,
        },
        updatedAt: savedAt,
      }),
      job.revision,
    );
    await input.repository.appendEvent({
      eventId: randomUUID(),
      jobId: job.jobId,
      stage: "evidence_acquisition",
      status:
        referenceResult.outcome === "complete" ? "succeeded" : "progress",
      message:
        referenceResult.outcome === "complete"
          ? `已获得${referenceResult.verifiedReferences.length}篇可验证参考文献。`
          : referenceResult.warnings.at(-1)?.message ??
            "参考文献获取已完成，将按当前可用结果继续生成文档。",
      category: "validation",
      operation: "references.acquire.completed",
      correlationId: job.jobId,
      metadata: {
        outcome: referenceResult.outcome,
        candidateCount: referenceResult.candidateCount,
        relevanceRejectedCount: referenceResult.relevanceRejectedCount,
        verifiedCount: referenceResult.verifiedReferences.length,
        providerCalls: referenceResult.providerCalls,
        durationMs: referenceResult.durationMs,
      },
      errorCode: referenceFailureMessage
        ? "reference_pipeline_failed"
        : undefined,
      technicalMessage: referenceFailureMessage?.slice(0, 2_000),
      createdAt: savedAt,
    });
    return job;
  }

  const availableEvidence = [
    ...intake.evidence,
    ...(job.checkpoint.referenceResult?.evidence ?? []),
  ];
  const availableEvidenceIds = [
    ...new Set(availableEvidence.map((item) => item.evidenceId)),
  ];

  if (!planning.figureIntentsCompleted) {
    const figureDraft =
      planning.request.userRequirements.visualIntent === "forbidden"
        ? { figures: [] }
        : await planner.planFigureIntents({
            request: planning.request,
            template: planning.template,
            skeleton: planning.skeleton,
            evidenceContext: {
              verifiedEvidenceAvailable: availableEvidenceIds.length > 0,
              verifiedEvidenceCount: availableEvidenceIds.length,
            },
            planningRevision: planning.planningRevision,
          });
    const skeleton = materializeFigureIntents({
      skeleton: planning.skeleton,
      draft: figureDraft,
    });
    planning = {
      ...planning,
      skeleton,
      figureIntentsCompleted: true,
    };
    job = await saveAndContinue(planning, 8);
    await logSaved(
      "outline.figure_intents",
      planning.request.userRequirements.visualIntent === "forbidden"
        ? "Figure planning skipped because the user forbade figures."
        : "Document figure intents saved.",
      {
        figureCount: skeleton.figures.length,
        skipped:
          planning.request.userRequirements.visualIntent === "forbidden",
      },
    );
    return job;
  }

  const skeleton = planning.skeleton;
  const planned = new Set(planning.sectionPlans.map((item) => item.sectionId));
  const section = skeleton.sections.find((item) => !planned.has(item.sectionId));
  if (section) {
    const sectionPlan = materializeSectionPlan({
      sectionId: section.sectionId,
      draft: await planner.planSection({
        request: planning.request, template: planning.template, skeleton, section,
        availableEvidenceIds,
        availableEvidence: availableEvidence.map((item) => ({
          evidenceId: item.evidenceId,
          excerpt: item.excerpt,
        })),
        planningRevision: planning.planningRevision,
      }),
    });
    planning = { ...planning, sectionPlans: [...planning.sectionPlans, sectionPlan] };
    const progress = 8 + Math.round((planning.sectionPlans.length / skeleton.sections.length) * 4);
    job = await saveAndContinue(planning, progress);
    await logSaved("outline.section_plan", `Section plan saved: ${section.heading}`, {
      plannedSections: planning.sectionPlans.length, totalSections: skeleton.sections.length,
    }, section.sectionId);
    return job;
  }

  const proposal = assembleSemanticOutline({ skeleton, sectionPlans: planning.sectionPlans });
  const plan = createDocumentPlanFromProposal({
    request: planning.request, template: planning.template, proposal,
    availableEvidenceIds,
  });
  const orchestration = createDocumentOrchestrationState({
    jobId: job.jobId, request: planning.request, plan,
    verifiedReferences: planning.evidenceReferences,
    evidenceBundle: availableEvidence.map((item) => ({
      evidenceId: item.evidenceId,
      excerpt: item.excerpt,
      locator: item.locator,
    })),
  });
  const now = new Date().toISOString();
  job = await input.repository.save(DocumentJobSchema.parse({
    ...job, status: "running", stage: "planning", progress: 12,
    totalComponents: orchestration.components.length,
    checkpoint: {
      ...job.checkpoint, planning, orchestration,
      executionSnapshot: {
        requestSchemaVersion: "1", planSchemaVersion: "1", finalSpecSchemaVersion: "1",
        intentPromptVersion: "document-request-v1", plannerPromptVersion: "document-hierarchical-outline-v2",
        generatorPromptVersion: "document-component-contract-v2", validatorVersion: "mature-content-v1",
        modelProvider: input.textExecutor.profile.provider, modelId: input.textExecutor.profile.resolvedModelId,
        rendererVersion: "sci-word-v1", templateChecksum: planning.template.snapshot.checksum,
        evidenceSnapshotId: planning.evidenceSnapshotId,
      },
      budget: {
        maxModelCalls: Math.max(32, orchestration.components.length + planning.sectionPlans.length + 12),
        maxImageCalls: 8, maxImageAssets: 4, maxRepairAttempts: 8,
        maxExecutionMs: 15 * 60_000, usedModelCalls: 2 + planning.sectionPlans.length,
        usedImageCalls: 0, completedImageAssets: 0, usedRepairAttempts: 0, usedExecutionMs: 0,
      }, savedAt: now,
    }, updatedAt: now,
  }), job.revision);
  await logSaved("outline.assemble", "Hierarchical document plan assembled.", {
    componentCount: plan.components.length, sectionCount: planning.sectionPlans.length,
  });
  return job;
}
