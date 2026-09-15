import type { GrantDocumentMemorySnapshot } from "../assistant/document-memory-contracts.ts";

export interface GrantDocumentMemoryRepository {
  findReusable(input: {
    documentId: string;
    sourceRevisionId: string;
    contextHash: string;
    policyVersion: string;
  }): Promise<GrantDocumentMemorySnapshot | null>;
  save(snapshot: GrantDocumentMemorySnapshot): Promise<GrantDocumentMemorySnapshot>;
}
