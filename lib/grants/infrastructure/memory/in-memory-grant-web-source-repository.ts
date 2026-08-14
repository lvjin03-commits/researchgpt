import type { GrantWebSourceRepository } from "../../ports/grant-web-source-repository.ts";
import type { GrantWebSearchSession, GrantWebSourceSnapshot } from "../../web-sources/contracts.ts";

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryGrantWebSourceRepository implements GrantWebSourceRepository {
  private sessions = new Map<string, GrantWebSearchSession>();
  private snapshots = new Map<string, GrantWebSourceSnapshot[]>();
  async createSearchSession(session: GrantWebSearchSession) { this.sessions.set(session.searchSessionId, clone(session)); }
  async getSearchSession(searchSessionId: string) { const session = this.sessions.get(searchSessionId); return session ? clone(session) : null; }
  async saveConfirmedSnapshots(input: { searchSessionId: string; snapshots: GrantWebSourceSnapshot[]; status: GrantWebSearchSession["status"] }) {
    const session = this.sessions.get(input.searchSessionId);
    if (!session) throw new Error("Web search session does not exist.");
    const existing = this.snapshots.get(input.searchSessionId) ?? [];
    const byResult = new Map(existing.map((snapshot) => [snapshot.resultId, snapshot]));
    for (const snapshot of input.snapshots) byResult.set(snapshot.resultId, clone(snapshot));
    this.snapshots.set(input.searchSessionId, [...byResult.values()]);
    this.sessions.set(input.searchSessionId, { ...session, status: input.status });
  }
  async listSnapshots(searchSessionId: string) { return clone(this.snapshots.get(searchSessionId) ?? []); }
}

