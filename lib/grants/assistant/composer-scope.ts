import {
  GRANT_ASSISTANT_CHAT_OPERATION,
  GRANT_EDIT_SESSION_TURN_OPERATION,
} from "../model-execution/operation-registry.ts";

export type GrantAssistantTextSelection = {
  startOffset: number;
  endOffset: number;
  text: string;
};

export type GrantAssistantComposerScope =
  | { kind: "chat" }
  | {
      kind: "edit";
      editSessionId: string | null;
      targetNodeId: string;
      targetLabel: string;
      selection?: GrantAssistantTextSelection;
    };

export type GrantAssistantComposerAction =
  | { type: "reference_selection" }
  | { type: "select_edit_target"; targetNodeId: string; targetLabel: string; selection?: GrantAssistantTextSelection }
  | { type: "resolve_edit_session"; targetNodeId: string; editSessionId: string }
  | { type: "exit_edit" };

export function reduceGrantAssistantComposerScope(
  scope: GrantAssistantComposerScope,
  action: GrantAssistantComposerAction,
): GrantAssistantComposerScope {
  if (action.type === "reference_selection") return scope;
  if (action.type === "exit_edit") return { kind: "chat" };
  if (action.type === "select_edit_target") {
    return {
      kind: "edit",
      editSessionId: null,
      targetNodeId: action.targetNodeId,
      targetLabel: action.targetLabel,
      selection: action.selection,
    };
  }
  if (scope.kind !== "edit" || scope.targetNodeId !== action.targetNodeId) return scope;
  return { ...scope, editSessionId: action.editSessionId };
}

export type GrantAssistantOperationResolution =
  | { status: "ready"; operation: typeof GRANT_ASSISTANT_CHAT_OPERATION }
  | { status: "ready"; operation: typeof GRANT_EDIT_SESSION_TURN_OPERATION; editSessionId: string }
  | { status: "blocked"; reason: "edit_session_not_ready" };

export function resolveGrantAssistantOperation(scope: GrantAssistantComposerScope): GrantAssistantOperationResolution {
  if (scope.kind === "chat") return { status: "ready", operation: GRANT_ASSISTANT_CHAT_OPERATION };
  if (!scope.editSessionId) return { status: "blocked", reason: "edit_session_not_ready" };
  return { status: "ready", operation: GRANT_EDIT_SESSION_TURN_OPERATION, editSessionId: scope.editSessionId };
}
