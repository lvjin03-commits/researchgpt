import type { GrantDocumentMemorySnapshot } from "../../assistant/document-memory-contracts.ts";
import type { GrantDocumentMemoryRepository } from "../../ports/grant-document-memory-repository.ts";

function clone<T>(value: T): T { return structuredClone(value); }

export class InMemoryGrantDocumentMemoryRepository implements GrantDocumentMemoryRepository {
  private readonly snapshots: GrantDocumentMemorySnapshot[] = [];

  async findReusable(input: {
    documentId: string;
    sourceRevisionId: string;
    contextHash: string;
    policyVersion: string;
  }) {
    const snapshot = [...this.snapshots].reverse().find((candidate) =>
      candidate.documentId === input.documentId
      && candidate.sourceRevisionId === input.sourceRevisionId
      && candidate.contextHash === input.contextHash
      && candidate.policyVersion === input.policyVersion);
    return snapshot ? clone(snapshot) : null;
  }

  async save(snapshot: GrantDocumentMemorySnapshot) {
    const stored = clone(snapshot);
    const index = this.snapshots.findIndex((candidate) => candidate.memoryId === stored.memoryId);
    if (index >= 0) this.snapshots[index] = stored;
    else this.snapshots.push(stored);
    return clone(stored);
  }
}
