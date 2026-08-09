import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantChecker, GrantCheckerFindingCandidate, GrantCheckerInput } from "../diagnostics/checker.ts";
import { GrantModelDataGateway } from "./grant-model-data-gateway.ts";

export const GRANT_SEMANTIC_DIAGNOSTIC_CHECKER_ID = "grant-semantic-argument-diagnostic";

export class GrantSemanticDiagnosticChecker implements GrantChecker {
  readonly checkerId = GRANT_SEMANTIC_DIAGNOSTIC_CHECKER_ID;
  readonly checkerVersion = "1.0.0";
  readonly contractVersion = "grant-semantic-diagnostic-v1";
  readonly inputMode = "full_document" as const;
  readonly supportedInputModes = ["full_document", "section_bundle"] as const;
  readonly configurationFingerprint: string;
  private readonly gateway: GrantModelDataGateway;

  constructor(gateway: GrantModelDataGateway, modelId: string) {
    this.gateway = gateway;
    this.configurationFingerprint = sha256Canonical({ provider: "openai", modelId, promptVersion: this.contractVersion });
  }

  async check(input: GrantCheckerInput) {
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
        authorizedEvidenceCardCount: output.authorizedEvidenceCardIds.length,
      },
    };
  }
}
