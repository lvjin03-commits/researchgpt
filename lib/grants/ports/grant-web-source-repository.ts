import type { GrantWebSearchSession, GrantWebSourceSnapshot } from "../web-sources/contracts.ts";

export interface GrantWebSourceRepository {
  createSearchSession(session: GrantWebSearchSession): Promise<void>;
  getSearchSession(searchSessionId: string): Promise<GrantWebSearchSession | null>;
  saveConfirmedSnapshots(input: { searchSessionId: string; snapshots: GrantWebSourceSnapshot[]; status: GrantWebSearchSession["status"] }): Promise<void>;
  listSnapshots(searchSessionId: string): Promise<GrantWebSourceSnapshot[]>;
}

