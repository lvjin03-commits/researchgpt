import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantWebSourceService, GrantWebSourceError } from "../lib/grants/application/grant-web-source-service.ts";
import { InMemoryGrantWebSourceRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-web-source-repository.ts";

const documentId = randomUUID();
const actorId = randomUUID();
let fetchCount = 0;
let uploadCount = 0;
const permissionUpdates: unknown[] = [];
const evidenceService = {
  authorization: { async update(input: unknown) { permissionUpdates.push(input); } },
  async upload() {
    uploadCount += 1;
    return { source: { sourceId: randomUUID() } };
  },
};
const service = new GrantWebSourceService({
  revisionService: { async getDocument() { return {}; } } as never,
  evidenceService: evidenceService as never,
  repository: new InMemoryGrantWebSourceRepository(),
  searchProvider: { async search() { return [
    { title: "Public paper", url: "https://example.org/paper", snippet: "Relevant abstract", provider: "test" },
    { title: "Private host", url: "https://127.0.0.1/secret", snippet: "must be removed", provider: "test" },
  ]; } },
  fetcher: { async fetchSnapshot(input) {
    fetchCount += 1;
    assert.equal(input.url, "https://example.org/paper");
    return { finalUrl: input.url, title: "Captured public paper", text: "A fixed, user-confirmed source snapshot.", mediaType: "text/html" };
  } },
});

const search = await service.search({ documentId, query: "electrolyte interface", actorId });
assert.equal(search.results.length, 1);
assert.equal(fetchCount, 0, "search results must not be fetched or sent as evidence before user selection");
const confirmed = await service.confirmSources({ searchSessionId: search.searchSessionId, resultIds: [search.results[0]!.resultId], ownerId: actorId, actorId });
assert.equal(fetchCount, 1);
assert.equal(uploadCount, 1);
assert.equal(permissionUpdates.length, 1);
assert.equal(confirmed.snapshots.length, 1);
assert.equal(confirmed.evidenceSourceIds.length, 1);
await assert.rejects(
  service.confirmSources({ searchSessionId: search.searchSessionId, resultIds: [search.results[0]!.resultId], ownerId: actorId, actorId }),
  (error: unknown) => error instanceof GrantWebSourceError && error.code === "web_search_closed",
);
console.log("Grant web-source confirmation contracts verified.");

