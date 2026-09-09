import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { GrantWebPublicSourceSnapshotSchema, GrantWebSourceUsageEventSchema } from "../lib/grants/web-sources/contracts.ts";
import { createGrantWebSourceRecord } from "../lib/grants/web-sources/source-record.ts";
import { SupabaseGrantWebGroundingRepository } from "../lib/grants/infrastructure/supabase/supabase-grant-web-grounding-repository.ts";
import { SupabaseGrantWebSearchEgressAuditRepository } from "../lib/grants/infrastructure/supabase/supabase-grant-web-search-egress-audit-repository.ts";
import { isGrantWebGroundingEnabled } from "../lib/grants/server/config.ts";

const source = createGrantWebSourceRecord({ sourceId: randomUUID(), providerId: "google_custom_search", url: "https://example.edu/a", title: "Public title", snippet: "Bounded public snippet", retrievedAt: "2026-09-08T12:00:00.000Z" });
GrantWebPublicSourceSnapshotSchema.parse(Object.fromEntries(Object.entries(source).filter(([key]) => key !== "sourceId" && key !== "retrievedAt")));
const event = GrantWebSourceUsageEventSchema.parse({ usageEventId: randomUUID(), documentId: randomUUID(), assistantSessionId: null, turnId: randomUUID(), searchAuditId: randomUUID(), sourceId: source.sourceId, contentFingerprint: source.contentFingerprint, eventType: "retrieved", createdAt: source.retrievedAt });

const calls: Array<{ operation: string; parameters: Record<string, unknown> }> = [];
const client = { async rpc(operation: string, parameters: Record<string, unknown>) { calls.push({ operation, parameters }); return { data: operation === "list_grant_web_turn_sources" ? [] : null, error: null }; } };
const ownerId = randomUUID();
await new SupabaseGrantWebSearchEgressAuditRepository(client, ownerId).append({ auditId: event.searchAuditId, documentId: event.documentId, sourceRevision: 1, actorId: ownerId, providerId: "google_custom_search", policyVersion: "grant-web-search-egress-v1", decision: "allowed", candidateHash: "a".repeat(64), outgoingQuery: "safe query", issues: [], createdAt: source.retrievedAt });
const repository = new SupabaseGrantWebGroundingRepository(client, ownerId);
await repository.saveSearchResults({ documentId: event.documentId, searchAuditId: event.searchAuditId, sources: [source], usageEvents: [event] });
await repository.appendUsageEvents({ documentId: event.documentId, events: [{ ...event, usageEventId: randomUUID(), eventType: "cited" }] });
await repository.listTurnSources({ documentId: event.documentId, turnId: event.turnId });
assert.deepEqual(calls.map((call) => call.operation), ["append_grant_web_search_egress_audit", "save_grant_web_search_results", "append_grant_web_source_usage_events", "list_grant_web_turn_sources"]);
assert.ok(calls.every((call) => call.parameters.p_owner_id === ownerId));

const migration = await readFile(new URL("../supabase/migrations/067_grant_web_grounding_persistence.sql", import.meta.url), "utf8");
for (const token of ["grant_web_public_sources", "grant_web_search_egress_audits", "grant_web_source_usage_events", "item-'sourceId'-'retrievedAt'", "document.owner_id=p_owner_id", "grant_web_usage_session_invalid", "grant_web_usage_source_not_retrieved", "jsonb_array_elements(p_sources)", "TO service_role", "grant.web_query.rewrite", "grant-web-query-rewrite-v1", "grant.web_source.assess", "grant.web_answer.synthesize"]) assert.ok(migration.includes(token), token);
assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|EXECUTE)[^;]* TO authenticated/iu);
assert.doesNotMatch(migration, /document_text|sensitive_terms|response_body/iu);

delete process.env.GRANT_WEB_GROUNDING_ENABLED; delete process.env.GRANT_WEB_GROUNDING_DATABASE_SCHEMA; delete process.env.GRANT_WEB_GROUNDING_PRICE_CATALOG_VERSION;
assert.equal(isGrantWebGroundingEnabled(), false);
process.env.GRANT_WEB_GROUNDING_ENABLED = "true"; process.env.GRANT_WEB_GROUNDING_DATABASE_SCHEMA = "066";
assert.equal(isGrantWebGroundingEnabled(), false);
process.env.GRANT_WEB_GROUNDING_DATABASE_SCHEMA = "067";
assert.equal(isGrantWebGroundingEnabled(), false);
process.env.GRANT_WEB_GROUNDING_PRICE_CATALOG_VERSION = "001";
assert.equal(isGrantWebGroundingEnabled(), true);

console.log("Grant web grounding persistence, owner isolation and schema gate verified offline.");
