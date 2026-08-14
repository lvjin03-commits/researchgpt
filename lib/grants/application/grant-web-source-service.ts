import { createHash, randomUUID } from "node:crypto";
import type { GrantEvidenceService } from "./evidence-service.ts";
import type { GrantRevisionService } from "./revision-service.ts";
import type { GrantWebSearchProvider, GrantWebSourceFetcher } from "../ports/grant-web-source-provider.ts";
import type { GrantWebSourceRepository } from "../ports/grant-web-source-repository.ts";
import { GrantWebSearchSessionSchema, GrantWebSourceSnapshotSchema } from "../web-sources/contracts.ts";

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const SEARCH_TTL_MS = 30 * 60 * 1000;

export class GrantWebSourceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "GrantWebSourceError"; }
}

function assertPublicHttpsUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new GrantWebSourceError("web_url_invalid", "The web source URL is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new GrantWebSourceError("web_url_not_public_https", "Only public HTTPS sources are allowed.");
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1"
    || /^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host)
    || /^169\.254\./u.test(host) || /^172\.(?:1[6-9]|2[0-9]|3[01])\./u.test(host)) {
    throw new GrantWebSourceError("web_url_private", "Private or local network sources are not allowed.");
  }
  return url.toString();
}

function safeFileName(title: string, index: number) {
  const normalized = title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120);
  return `${normalized || `web-source-${index + 1}`}.txt`;
}

export class GrantWebSourceService {
  private readonly dependencies: {
    revisionService: GrantRevisionService;
    evidenceService: GrantEvidenceService;
    repository: GrantWebSourceRepository;
    searchProvider: GrantWebSearchProvider;
    fetcher: GrantWebSourceFetcher;
    createId?: () => string;
    now?: () => string;
  };
  private readonly createId: () => string;
  private readonly now: () => string;
  constructor(dependencies: {
    revisionService: GrantRevisionService;
    evidenceService: GrantEvidenceService;
    repository: GrantWebSourceRepository;
    searchProvider: GrantWebSearchProvider;
    fetcher: GrantWebSourceFetcher;
    createId?: () => string;
    now?: () => string;
  }) {
    this.dependencies = dependencies;
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async search(input: { documentId: string; query: string; actorId: string }) {
    await this.dependencies.revisionService.getDocument(input.documentId);
    const query = input.query.trim();
    if (query.length < 2 || query.length > 500) throw new GrantWebSourceError("web_query_invalid", "Search query length is invalid.");
    const raw = await this.dependencies.searchProvider.search({ query, maximumResults: 10 });
    const seen = new Set<string>();
    const results = raw.flatMap((result) => {
      try {
        const url = assertPublicHttpsUrl(result.url);
        if (seen.has(url)) return [];
        seen.add(url);
        return [{ resultId: this.createId(), title: result.title, url, snippet: result.snippet, provider: result.provider }];
      } catch { return []; }
    }).slice(0, 10);
    const createdAt = this.now();
    const session = GrantWebSearchSessionSchema.parse({
      searchSessionId: this.createId(), documentId: input.documentId, query,
      status: "awaiting_selection", results, createdBy: input.actorId, createdAt,
      expiresAt: new Date(Date.parse(createdAt) + SEARCH_TTL_MS).toISOString(),
    });
    await this.dependencies.repository.createSearchSession(session);
    return session;
  }

  async confirmSources(input: { searchSessionId: string; resultIds: string[]; ownerId: string; actorId: string }) {
    const session = await this.dependencies.repository.getSearchSession(input.searchSessionId);
    if (!session) throw new GrantWebSourceError("web_search_not_found", "The search session does not exist.");
    if (session.status !== "awaiting_selection" && session.status !== "partially_confirmed") throw new GrantWebSourceError("web_search_closed", "The search session is closed.");
    if (Date.parse(session.expiresAt) <= Date.parse(this.now())) throw new GrantWebSourceError("web_search_expired", "The search result selection has expired.");
    const selectedIds = [...new Set(input.resultIds)];
    if (selectedIds.length === 0 || selectedIds.length > 5) throw new GrantWebSourceError("web_selection_invalid", "Select between one and five web sources.");
    const byId = new Map(session.results.map((result) => [result.resultId, result]));
    if (selectedIds.some((id) => !byId.has(id))) throw new GrantWebSourceError("web_result_unknown", "A selected result was not issued by this search session.");
    const existing = new Map((await this.dependencies.repository.listSnapshots(session.searchSessionId)).map((snapshot) => [snapshot.resultId, snapshot]));
    const snapshots = [];
    for (const [index, resultId] of selectedIds.entries()) {
      const prior = existing.get(resultId);
      if (prior) { snapshots.push(prior); continue; }
      const result = byId.get(resultId)!;
      const requestedUrl = assertPublicHttpsUrl(result.url);
      const fetched = await this.dependencies.fetcher.fetchSnapshot({ url: requestedUrl, maximumBytes: MAX_SNAPSHOT_BYTES });
      const finalUrl = assertPublicHttpsUrl(fetched.finalUrl);
      const text = fetched.text.trim();
      const buffer = Buffer.from(text, "utf8");
      if (!text || buffer.byteLength > MAX_SNAPSHOT_BYTES) throw new GrantWebSourceError("web_snapshot_invalid", "The selected page has no usable bounded text snapshot.");
      const evidence = await this.dependencies.evidenceService.upload({
        ownerId: input.ownerId, actorId: input.actorId, documentId: session.documentId,
        fileName: safeFileName(fetched.title || result.title, index), mediaType: "text/plain",
        buffer, provenanceType: "published_literature", sensitivity: "public",
      });
      await this.dependencies.evidenceService.authorization.update({
        documentId: session.documentId, sourceId: evidence.source.sourceId, expectedRevision: 1,
        permissions: { read: true, index: true, sendRelevantExcerptToModel: true, useForReasoning: true, useForCitation: false },
        actorId: input.actorId,
      });
      const snapshot = GrantWebSourceSnapshotSchema.parse({
        snapshotId: this.createId(), documentId: session.documentId, searchSessionId: session.searchSessionId,
        resultId, requestedUrl, finalUrl, title: fetched.title || result.title,
        contentHash: createHash("sha256").update(buffer).digest("hex"), capturedByteSize: buffer.byteLength,
        evidenceSourceId: evidence.source.sourceId, capturedBy: input.actorId, capturedAt: this.now(),
      });
      await this.dependencies.repository.saveConfirmedSnapshots({ searchSessionId: session.searchSessionId, snapshots: [snapshot], status: "partially_confirmed" });
      snapshots.push(snapshot);
    }
    await this.dependencies.repository.saveConfirmedSnapshots({ searchSessionId: session.searchSessionId, snapshots: [], status: "completed" });
    return { searchSessionId: session.searchSessionId, snapshots, evidenceSourceIds: snapshots.map((snapshot) => snapshot.evidenceSourceId) };
  }
}
