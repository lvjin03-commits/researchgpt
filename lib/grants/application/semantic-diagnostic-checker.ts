import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantChecker, GrantCheckerFindingCandidate, GrantCheckerInput } from "../diagnostics/checker.ts";
import {
  GRANT_DIAGNOSTIC_POLICY_VERSION,
  GRANT_DIAGNOSTIC_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_SCHEMA_VERSION,
  GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION,
  GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
  GRANT_DIAGNOSTIC_V3_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION,
} from "../ports/grant-diagnostic-model.ts";
import { GrantModelDataGateway } from "./grant-model-data-gateway.ts";

export const GRANT_SEMANTIC_DIAGNOSTIC_CHECKER_ID = "grant-semantic-argument-diagnostic";

export class GrantSemanticDiagnosticChecker implements GrantChecker {
  readonly checkerId = GRANT_SEMANTIC_DIAGNOSTIC_CHECKER_ID;
  readonly checkerVersion: string;
  readonly contractVersion: string;
  readonly inputMode = "full_document" as const;
  readonly supportedInputModes = ["full_document", "section_bundle"] as const;
  readonly configurationFingerprint: string;
  private readonly gateway: GrantModelDataGateway;

  private readonly version: "v2" | "v3";

  constructor(gateway: GrantModelDataGateway, modelId: string, version: "v2" | "v3" = "v2") {
    this.gateway = gateway;
    this.version = version;
    this.checkerVersion = version === "v3" ? "3.0.0" : "2.0.0";
    this.contractVersion = version === "v3" ? GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION : GRANT_DIAGNOSTIC_SCHEMA_VERSION;
    this.configurationFingerprint = sha256Canonical({
      provider: "openai",
      modelId,
      promptVersion: version === "v3" ? GRANT_DIAGNOSTIC_V3_PROMPT_VERSION : GRANT_DIAGNOSTIC_PROMPT_VERSION,
      policyVersion: version === "v3" ? GRANT_DIAGNOSTIC_V3_POLICY_VERSION : GRANT_DIAGNOSTIC_POLICY_VERSION,
      schemaVersion: version === "v3" ? GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION : GRANT_DIAGNOSTIC_SCHEMA_VERSION,
    });
  }

  async check(input: GrantCheckerInput) {
    if (this.version === "v3") {
      const { generated, prepared } = await this.gateway.diagnoseV3({
        documentId: input.documentId,
        taskId: input.executionId,
        snapshot: input.snapshot,
        inputMode: input.inputMode,
        inputSectionIds: input.inputSectionIds,
        inputNodeIds: input.inputNodeIds,
        fundingCategory: input.fundingCategory,
        priorFindings: input.priorSemanticFindings,
      });
      return {
        findings: [],
        metadata: {
          provider: generated.provider,
          modelId: generated.modelId,
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          reasoningTokens: generated.usage.reasoningTokens,
          execution: generated.execution,
          authorizedEvidenceCardCount: prepared.allowedEvidenceCardIds.size,
        },
        semanticV3: {
          result: { findings: generated.findings },
          referenceScope: {
            sectionIdByNodeId: prepared.sectionIdByNodeId,
            allowedEvidenceCardIds: prepared.allowedEvidenceCardIds,
          },
          execution: generated.execution,
          provider: generated.provider,
          modelId: generated.modelId,
          usage: generated.usage,
        },
      };
    }
    const output = await this.gateway.diagnose({
      documentId: input.documentId,
      taskId: input.executionId,
      snapshot: input.snapshot,
      inputMode: input.inputMode,
      inputSectionIds: input.inputSectionIds,
      inputNodeIds: input.inputNodeIds,
    });
    const findings = output.findings.map((finding): GrantCheckerFindingCandidate => ({
      code: finding.category,
      message: finding.message,
      recommendation: finding.recommendation,
      assessment: finding.assessment,
      subjectKey: `semantic:${finding.category}:${finding.sectionId}:${finding.nodeId}`,
      conclusion: "issue_present",
      sectionId: finding.sectionId,
      nodeId: finding.nodeId,
    }));
    return {
      findings: [...new Map(findings.map((finding) => [finding.subjectKey, finding])).values()],
      metadata: {
        provider: output.provider,
        modelId: output.modelId,
        inputTokens: output.usage.inputTokens,
        outputTokens: output.usage.outputTokens,
        reasoningTokens: output.usage.reasoningTokens,
        execution: output.execution,
        authorizedEvidenceCardCount: output.authorizedEvidenceCardIds.length,
      },
    };
  }
}
