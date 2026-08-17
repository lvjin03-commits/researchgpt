import type { GrantAssistantMessage, GrantAssistantSession } from "../assistant/session-contracts.ts";

export interface GrantAssistantSessionRepository {
  ensureSession(input: { documentId: string; sessionId: string; now: string }): Promise<GrantAssistantSession>;
  getCurrentSession(documentId: string): Promise<GrantAssistantSession | null>;
  listMessages(sessionId: string): Promise<GrantAssistantMessage[]>;
  appendTurn(input: { sessionId: string; userMessage: GrantAssistantMessage; assistantMessage: GrantAssistantMessage; lastActiveAt: string }): Promise<void>;
  linkEditSession(input: { assistantSessionId: string; editSessionId: string; linkedAt: string }): Promise<void>;
}
