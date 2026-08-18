import type { GrantAssistantDocumentSelectionContext } from "./contracts.ts";
import type { GrantAssistantCandidateContext } from "./contracts.ts";

export type GrantAssistantFocus =
  | {
      kind: "document_selection";
      focusId: string;
      targetLabel: string;
      contextCardId: string;
      nodeId: string;
      contentHash: string;
    }
  | {
      kind: "edit_candidate";
      focusId: string;
      targetLabel: string;
      editSessionId: string;
      candidateId: string;
      contentHash: string;
    };

export type GrantAssistantFocusResolution =
  | { kind: "none" }
  | { kind: "resolved"; focus: GrantAssistantFocus }
  | { kind: "ambiguous"; ambiguityId: string; choices: GrantAssistantFocus[] };

const IMPLICIT_REFERENCE = /(?:这|那)(?:一)?(?:段|句|版|个)|刚才(?:的)?(?:内容|那版|这版)?|上(?:一)?版|前(?:一)?版|当前(?:这)?版|\b(?:this|that|it|previous|current)\b/iu;

export function documentSelectionFocuses(
  cards: GrantAssistantDocumentSelectionContext[],
): GrantAssistantFocus[] {
  return cards.map((card) => ({
    kind: "document_selection",
    focusId: card.contextCardId,
    contextCardId: card.contextCardId,
    targetLabel: card.targetLabel,
    nodeId: card.nodeId,
    contentHash: card.textHash,
  }));
}

export function candidateContextFocus(context: GrantAssistantCandidateContext): GrantAssistantFocus {
  return {
    kind: "edit_candidate",
    focusId: context.candidateId,
    targetLabel: context.targetLabel,
    editSessionId: context.editSessionId,
    candidateId: context.candidateId,
    contentHash: context.expectedCandidateHash,
  };
}

export function resolveGrantAssistantFocus(input: {
  message: string;
  available: GrantAssistantFocus[];
  explicitFocusId?: string | null;
  ignoreAmbiguousFocus?: boolean;
}): GrantAssistantFocusResolution {
  if (input.ignoreAmbiguousFocus) return { kind: "none" };
  if (input.explicitFocusId) {
    const selected = input.available.find((focus) => focus.focusId === input.explicitFocusId);
    return selected ? { kind: "resolved", focus: selected } : { kind: "none" };
  }
  if (input.available.length === 0) return { kind: "none" };
  if (input.available.length === 1) return { kind: "resolved", focus: input.available[0]! };
  if (!IMPLICIT_REFERENCE.test(input.message)) return { kind: "none" };
  const choices = [...input.available].sort((left, right) => left.focusId.localeCompare(right.focusId));
  return {
    kind: "ambiguous",
    ambiguityId: `focus:${choices.map((choice) => choice.focusId).join(":")}`,
    choices,
  };
}
