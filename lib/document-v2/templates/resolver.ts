import { createHash } from "node:crypto";
import {
  DocumentRequestSchema,
  ResolvedTemplateSnapshotSchema,
  type DocumentRequest,
  type ResolvedTemplateSnapshot,
} from "../contracts";
import {
  TemplateMatchDecisionSchema,
  TemplateResolutionSchema,
  UserTemplateAnalysisSchema,
  type AiResponsibility,
  type TemplateCandidate,
  type TemplateResolution,
  type TemplateSnapshotSeed,
  type UserTemplateAnalysis,
} from "./contracts";
import {
  DOCUMENT_V2_TEMPLATE_REGISTRY,
  type DocumentTemplateRegistry,
} from "./registry";
import { SCI_REVIEW_TEMPLATE } from "./sci-review";

export interface DocumentTemplateMatcher {
  match(input: {
    request: DocumentRequest;
    candidates: ReadonlyArray<TemplateCandidate>;
  }): Promise<{
    templateId: string;
    confidence: number;
    rationale: string;
  }>;
}

export interface UserTemplateAnalyzer {
  analyze(input: {
    uploadId: string;
    request: DocumentRequest;
  }): Promise<UserTemplateAnalysis>;
}

export interface ResolveDocumentTemplateInput {
  request: DocumentRequest;
  matcher: DocumentTemplateMatcher;
  userTemplate?: {
    uploadId: string;
    analyzer: UserTemplateAnalyzer;
  };
  registry?: DocumentTemplateRegistry;
}

export class TemplateResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateResolutionError";
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function compileTemplateSnapshot(
  seed: TemplateSnapshotSeed,
): Readonly<ResolvedTemplateSnapshot> {
  const checksum = createHash("sha256")
    .update(canonicalJson(seed), "utf8")
    .digest("hex");
  return deepFreeze(
    ResolvedTemplateSnapshotSchema.parse({
      ...structuredClone(seed),
      checksum,
    }),
  );
}

function userTemplateResponsibilities(): AiResponsibility[] {
  return [...SCI_REVIEW_TEMPLATE.aiResponsibilities];
}

export async function resolveDocumentTemplate(
  input: ResolveDocumentTemplateInput,
): Promise<Readonly<TemplateResolution>> {
  const request = DocumentRequestSchema.parse(input.request);
  if (input.userTemplate) {
    const analysis = UserTemplateAnalysisSchema.parse(
      await input.userTemplate.analyzer.analyze({
        uploadId: input.userTemplate.uploadId,
        request,
      }),
    );
    if (analysis.language !== request.language) {
      throw new TemplateResolutionError(
        `Uploaded template language "${analysis.language}" does not match request language "${request.language}".`,
      );
    }
    const snapshot = compileTemplateSnapshot({
      templateId: `user-${input.userTemplate.uploadId}`,
      templateVersion: analysis.analysisVersion,
      origin: {
        kind: "user_upload",
        uploadId: input.userTemplate.uploadId,
        analysisVersion: analysis.analysisVersion,
      },
      renderingProfile: "sci_word_v1",
      contentProfile: "sci_review_v1",
      typography: analysis.typography,
      layout: analysis.layout,
      rules: analysis.rules,
    });
    return deepFreeze(
      TemplateResolutionSchema.parse({
        source: "user_upload",
        snapshot,
        componentBlueprints: analysis.componentBlueprints,
        aiResponsibilities: userTemplateResponsibilities(),
        warnings: analysis.warnings,
        selection: {
          rationale: "The user uploaded a template, so it takes precedence.",
        },
      }),
    );
  }

  const registry = input.registry ?? DOCUMENT_V2_TEMPLATE_REGISTRY;
  const candidates = registry.activeCandidates({
    language: request.language,
    outputFormat: request.outputFormat,
    documentType: request.templateIntent,
  });
  if (candidates.length === 0) {
    throw new TemplateResolutionError(
      "No active document template supports this request.",
    );
  }
  const decision = TemplateMatchDecisionSchema.parse(
    await input.matcher.match({
      request,
      candidates,
    }),
  );
  if (!candidates.some((candidate) => candidate.templateId === decision.templateId)) {
    throw new TemplateResolutionError(
      `Template matcher selected unavailable template "${decision.templateId}".`,
    );
  }
  const definition = registry.getActive(decision.templateId);
  const snapshot = compileTemplateSnapshot(definition.snapshotSeed);
  return deepFreeze(
    TemplateResolutionSchema.parse({
      source: "system_registry",
      snapshot,
      componentBlueprints: definition.componentBlueprints,
      aiResponsibilities: definition.aiResponsibilities,
      warnings: [],
      selection: {
        confidence: decision.confidence,
        rationale: decision.rationale,
      },
    }),
  );
}
