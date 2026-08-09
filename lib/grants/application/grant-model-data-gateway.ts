import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantFinding } from "../diagnostics/contracts.ts";
import type { GrantPatchModel, GrantPatchModelResult } from "../ports/grant-patch-model.ts";
import { grantEditableNodeText } from "../patching/patch-policy.ts";

export class GrantModelDataGateway {
  private readonly model: GrantPatchModel;

  constructor(model: GrantPatchModel) {
    this.model = model;
  }

  async propose(input: {
    snapshot: CanonicalGrantSnapshot;
    targetNodeId: string;
    finding?: GrantFinding;
    userInstruction: string;
  }): Promise<GrantPatchModelResult> {
    const node = input.snapshot.nodes.find((candidate) => candidate.nodeId === input.targetNodeId);
    const section = input.snapshot.sections.find((candidate) => candidate.sectionId === node?.sectionId);
    const targetText = grantEditableNodeText(input.snapshot, input.targetNodeId);
    const documentLanguage = /[\u3400-\u9fff]/u.test(input.snapshot.title + targetText) ? "zh" : "en";
    return this.model.generate({
      documentLanguage,
      sectionTitle: section?.title ?? "",
      targetText,
      findingMessage: input.finding?.message,
      findingRecommendation: input.finding?.recommendation,
      userInstruction: input.userInstruction,
    });
  }
}
