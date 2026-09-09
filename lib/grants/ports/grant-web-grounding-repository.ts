import type { GrantWebSourceRecord, GrantWebSourceUsageEvent } from "../web-sources/contracts.ts";

export interface GrantWebGroundingRepository {
  saveSearchResults(input: {
    documentId: string;
    searchAuditId: string;
    sources: GrantWebSourceRecord[];
    usageEvents: GrantWebSourceUsageEvent[];
  }): Promise<void>;
  appendUsageEvents(input: {
    documentId: string;
    events: GrantWebSourceUsageEvent[];
  }): Promise<void>;
  listTurnSources(input: { documentId: string; turnId: string }): Promise<Array<{
    source: GrantWebSourceRecord;
    eventType: GrantWebSourceUsageEvent["eventType"];
  }>>;
}
