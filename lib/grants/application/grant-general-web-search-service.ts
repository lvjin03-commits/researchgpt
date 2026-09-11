import { randomUUID } from "node:crypto";
import type { GrantGeneralWebSearchProvider } from "../ports/grant-general-web-search-provider.ts";
import type { GrantWebSearchEgressAuditRepository } from "../ports/grant-web-search-egress-audit-repository.ts";
import type { GrantWebGroundingRepository } from "../ports/grant-web-grounding-repository.ts";
import { GrantWebSearchEgressAuditSchema } from "../web-sources/query-audit-contracts.ts";
import { assessGrantWebSearchEgress } from "../web-sources/query-egress-policy.ts";
import { createGrantWebSourceRecord } from "../web-sources/source-record.ts";
import type { GrantGeneralWebSearchProviderUsage } from "../ports/grant-general-web-search-provider.ts";

export class GrantGeneralWebSearchService {
  private readonly dependencies: {
    provider: GrantGeneralWebSearchProvider;
    auditRepository: GrantWebSearchEgressAuditRepository;
    sourceRepository: GrantWebGroundingRepository;
    createId?: () => string;
    now?: () => string;
    onProviderUsage?: (event: GrantGeneralWebSearchProviderUsage & {
      billingOperationId: string; occurredAt: string;
    }) => Promise<void>;
  };
  constructor(dependencies: {
    provider: GrantGeneralWebSearchProvider;
    auditRepository: GrantWebSearchEgressAuditRepository;
    sourceRepository: GrantWebGroundingRepository;
    createId?: () => string;
    now?: () => string;
    onProviderUsage?: (event: GrantGeneralWebSearchProviderUsage & {
      billingOperationId: string; occurredAt: string;
    }) => Promise<void>;
  }) { this.dependencies = dependencies; }

  async search(input: {
    documentId: string;
    sourceRevision: number;
    actorId: string;
    assistantSessionId: string | null;
    turnId: string;
    candidateQuery: string;
    documentText: string;
    sensitiveTerms: readonly string[];
    maximumResults?: number;
    billingOperationId: string;
  }) {
    const createId = this.dependencies.createId ?? randomUUID;
    const now = this.dependencies.now ?? (() => new Date().toISOString());
    const decision = assessGrantWebSearchEgress(input);
    const audit = GrantWebSearchEgressAuditSchema.parse({
      auditId: createId(), documentId: input.documentId, sourceRevision: input.sourceRevision,
      actorId: input.actorId, providerId: this.dependencies.provider.providerId,
      policyVersion: decision.policyVersion, decision: decision.allowed ? "allowed" : "blocked",
      candidateHash: decision.candidateHash, outgoingQuery: decision.outgoingQuery,
      issues: decision.issues, createdAt: now(),
    });
    // Durable audit is required before any external dispatch.
    await this.dependencies.auditRepository.append(audit);
    if (!decision.allowed) return { status: "blocked" as const, decision, sources: [] };
    const providerResponse = await this.dependencies.provider.search({ approvedQuery: decision, maximumResults: input.maximumResults ?? 10 });
    await this.dependencies.onProviderUsage?.({ ...providerResponse.usage,
      billingOperationId: input.billingOperationId, occurredAt: now() });
    const seen = new Set<string>();
    const sources = providerResponse.results.flatMap((result) => {
      try {
        const record = createGrantWebSourceRecord({ ...result, sourceId: createId(), retrievedAt: now() });
        if (seen.has(record.contentFingerprint)) return [];
        seen.add(record.contentFingerprint);
        return [record];
      } catch { return []; }
    });
    const usageEvents = sources.map((source) => ({
      usageEventId: createId(), documentId: input.documentId, assistantSessionId: input.assistantSessionId,
      turnId: input.turnId, searchAuditId: audit.auditId, sourceId: source.sourceId,
      contentFingerprint: source.contentFingerprint, eventType: "retrieved" as const, createdAt: now(),
    }));
    await this.dependencies.sourceRepository.saveSearchResults({
      documentId: input.documentId, searchAuditId: audit.auditId, sources, usageEvents,
    });
    return { status: sources.length > 0 ? "completed" as const : "no_results" as const, decision,
      searchAuditId: audit.auditId, sources, providerUsage: providerResponse.usage };
  }
}
