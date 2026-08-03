import { z } from "zod";
import type {
  ResearchExplorationProviderAdapter,
  ResearchExplorationProviderInspection,
  ResearchExplorationProviderStart,
} from "../capability.ts";
import {
  ResearchExplorationInputSchema,
  ResearchExplorationProposalSchema,
  type ResearchExplorationInput,
  type ResearchExplorationProposal,
} from "../contracts.ts";

const ExternalIdentifierSchema = z.string().trim().min(1).max(160);
const ExternalTextSchema = z.string().trim().min(1).max(12_000);

const StormStartResponseSchema = z.object({
  remoteExecutionId: ExternalIdentifierSchema,
  status: z.enum(["queued", "running"]),
  nextCheckAt: z.iso.datetime({ offset: true }).optional(),
});

const StormInspectionResponseSchema = z.object({
  status: z.enum([
    "queued",
    "running",
    "partial",
    "complete",
    "failed",
    "unknown_outcome",
    "expired",
    "cancelled",
  ]),
  resultLocation: z.string().trim().min(1).max(2_000).optional(),
  nextCheckAt: z.iso.datetime({ offset: true }).optional(),
  failure: z
    .object({
      code: ExternalIdentifierSchema,
      category: z.enum(["contract", "provider", "infrastructure", "unknown_outcome"]),
      retryability: z.enum(["none", "safe", "unknown"]),
      technicalMessage: z.string().trim().min(1).max(8_000),
      userMessageCode: ExternalIdentifierSchema,
    })
    .optional(),
});

const StormResultSchema = z.object({
  schemaVersion: z.literal("storm-exploration-result-v1"),
  explorationId: ExternalIdentifierSchema,
  status: z.enum(["complete", "partial", "failed"]),
  perspectives: z
    .array(
      z.object({
        key: ExternalIdentifierSchema,
        title: ExternalTextSchema,
        rationale: ExternalTextSchema,
      }),
    )
    .default([]),
  questions: z
    .array(
      z.object({
        key: ExternalIdentifierSchema,
        perspectiveKey: ExternalIdentifierSchema,
        question: ExternalTextSchema,
        importance: z.enum(["high", "medium", "low"]).default("medium"),
        followUps: z.array(ExternalTextSchema).default([]),
      }),
    )
    .default([]),
  searches: z
    .array(
      z.object({
        key: ExternalIdentifierSchema,
        questionKey: ExternalIdentifierSchema,
        query: ExternalTextSchema,
        sourceType: z.enum(["web", "user_corpus"]),
      }),
    )
    .default([]),
  sources: z
    .array(
      z.object({
        key: ExternalIdentifierSchema,
        title: ExternalTextSchema,
        url: z.string().trim().min(1).max(2_000).optional(),
        doi: z.string().trim().min(1).max(300).optional(),
        authors: z.array(z.string().trim().min(1).max(300)).default([]),
        year: z.number().int().min(1000).max(2200).optional(),
        snippet: ExternalTextSchema.optional(),
        retrievedBy: ExternalIdentifierSchema,
      }),
    )
    .default([]),
  knowledge: z
    .array(
      z.object({
        key: ExternalIdentifierSchema,
        title: ExternalTextSchema,
        summary: ExternalTextSchema,
        parentKey: ExternalIdentifierSchema.optional(),
        sourceKeys: z.array(ExternalIdentifierSchema).default([]),
      }),
    )
    .default([]),
  outlines: z
    .array(
      z.object({
        key: ExternalIdentifierSchema,
        title: ExternalTextSchema,
        sections: z
          .array(
            z.object({
              heading: ExternalTextSchema,
              purpose: ExternalTextSchema,
              questionKeys: z.array(ExternalIdentifierSchema).default([]),
              sourceKeys: z.array(ExternalIdentifierSchema).default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  unresolvedQuestions: z.array(ExternalTextSchema).default([]),
  warnings: z.array(ExternalTextSchema).default([]),
  usage: z
    .object({
      modelCalls: z.number().int().nonnegative().default(0),
      searchCalls: z.number().int().nonnegative().default(0),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      estimatedCostUsd: z.number().nonnegative().optional(),
    })
    .default({ modelCalls: 0, searchCalls: 0 }),
});

export interface StormExplorationTransport {
  start(request: unknown): Promise<unknown>;
  inspect(remoteExecutionId: string): Promise<unknown>;
  loadResult(resultLocation: string): Promise<unknown>;
  cancel(remoteExecutionId: string): Promise<void>;
}

function deduplicateByKey<T>(input: {
  values: ReadonlyArray<T>;
  keyOf: (value: T) => string;
  collection: string;
  warnings: string[];
}): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of input.values) {
    const key = input.keyOf(value);
    if (seen.has(key)) {
      input.warnings.push(`STORM returned duplicate ${input.collection} key '${key}'; later value ignored.`);
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function validUrl(value: string | undefined, warnings: string[]): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    warnings.push(`STORM returned an invalid source URL; URL omitted: ${value.slice(0, 200)}`);
    return undefined;
  }
}

export function mapStormResultToProposal(raw: unknown): ResearchExplorationProposal {
  const result = StormResultSchema.parse(raw);
  const warnings = [...result.warnings];
  const perspectives = deduplicateByKey({
    values: result.perspectives,
    keyOf: (item) => item.key,
    collection: "perspective",
    warnings,
  });
  const perspectiveKeys = new Set(perspectives.map((item) => item.key));
  const questions = deduplicateByKey({
    values: result.questions.filter((item) => {
      if (perspectiveKeys.has(item.perspectiveKey)) return true;
      warnings.push(`Question '${item.key}' referenced a missing perspective and was omitted.`);
      return false;
    }),
    keyOf: (item) => item.key,
    collection: "question",
    warnings,
  });
  const questionKeys = new Set(questions.map((item) => item.key));
  const searches = deduplicateByKey({
    values: result.searches.filter((item) => {
      if (questionKeys.has(item.questionKey)) return true;
      warnings.push(`Search '${item.key}' referenced a missing question and was omitted.`);
      return false;
    }),
    keyOf: (item) => item.key,
    collection: "search",
    warnings,
  });
  const sources = deduplicateByKey({
    values: result.sources,
    keyOf: (item) => item.key,
    collection: "source",
    warnings,
  });
  const sourceKeys = new Set(sources.map((item) => item.key));
  const knowledge = deduplicateByKey({
    values: result.knowledge,
    keyOf: (item) => item.key,
    collection: "knowledge node",
    warnings,
  });
  const knowledgeKeys = new Set(knowledge.map((item) => item.key));
  const outlines = deduplicateByKey({
    values: result.outlines.filter((item) => {
      if (item.sections.length > 0) return true;
      warnings.push(`Outline '${item.key}' contained no sections and was omitted.`);
      return false;
    }),
    keyOf: (item) => item.key,
    collection: "outline",
    warnings,
  });

  const hasUsableResearch =
    perspectives.length > 0 && questions.length > 0 && outlines.length > 0;
  const status = result.status === "complete" && !hasUsableResearch
    ? "partial"
    : result.status;
  if (result.status === "complete" && status === "partial") {
    warnings.push("STORM marked the result complete, but required candidate collections were incomplete.");
  }

  return ResearchExplorationProposalSchema.parse({
    schemaVersion: 1,
    explorationId: result.explorationId,
    status,
    perspectives: perspectives.map((item) => ({
      perspectiveKey: item.key,
      title: item.title,
      rationale: item.rationale,
    })),
    researchQuestions: questions.map((item) => ({
      questionKey: item.key,
      perspectiveKey: item.perspectiveKey,
      question: item.question,
      importance: item.importance,
      followUpQuestions: item.followUps,
    })),
    searchPlans: searches.map((item) => ({
      queryKey: item.key,
      questionKey: item.questionKey,
      query: item.query,
      sourceType: item.sourceType,
    })),
    sourceCandidates: sources.map((item) => ({
      sourceCandidateKey: item.key,
      title: item.title,
      url: validUrl(item.url, warnings),
      doi: item.doi,
      authors: item.authors,
      year: item.year,
      snippet: item.snippet,
      retrievedBy: item.retrievedBy,
    })),
    knowledgeNodes: knowledge.map((item) => ({
      nodeKey: item.key,
      title: item.title,
      summary: item.summary,
      parentNodeKey: item.parentKey && knowledgeKeys.has(item.parentKey)
        ? item.parentKey
        : undefined,
      supportingSourceCandidateKeys: item.sourceKeys.filter((key) => sourceKeys.has(key)),
    })),
    outlineCandidates: outlines.map((item) => ({
      outlineKey: item.key,
      title: item.title,
      sections: item.sections.map((section) => ({
        heading: section.heading,
        purpose: section.purpose,
        questionKeys: section.questionKeys.filter((key) => questionKeys.has(key)),
        supportingSourceCandidateKeys: section.sourceKeys.filter((key) => sourceKeys.has(key)),
      })),
    })),
    unresolvedQuestions: result.unresolvedQuestions,
    warnings,
    usage: result.usage,
  });
}

export class StormResearchExplorationAdapter implements ResearchExplorationProviderAdapter {
  private readonly transport: StormExplorationTransport;

  constructor(transport: StormExplorationTransport) {
    this.transport = transport;
  }

  async start(input: ResearchExplorationInput): Promise<ResearchExplorationProviderStart> {
    const request = ResearchExplorationInputSchema.parse(input);
    return StormStartResponseSchema.parse(await this.transport.start({
      schemaVersion: "storm-exploration-request-v1",
      ...request,
    }));
  }

  async inspect(remoteExecutionId: string): Promise<ResearchExplorationProviderInspection> {
    return StormInspectionResponseSchema.parse(
      await this.transport.inspect(ExternalIdentifierSchema.parse(remoteExecutionId)),
    );
  }

  async loadResult(resultLocation: string): Promise<ResearchExplorationProposal> {
    return mapStormResultToProposal(await this.transport.loadResult(resultLocation));
  }

  async cancel(remoteExecutionId: string): Promise<void> {
    await this.transport.cancel(ExternalIdentifierSchema.parse(remoteExecutionId));
  }
}
