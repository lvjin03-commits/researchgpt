import {
  GrantEvidenceAuthorizationSchema,
  GrantEvidenceDependencySchema,
  GrantEvidenceResourceSchema,
  type GrantEvidenceDependency,
  type GrantEvidenceResource,
} from "../../evidence/contracts.ts";
import type { GrantEvidenceRepository } from "../../ports/grant-evidence-repository.ts";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryGrantEvidenceRepository implements GrantEvidenceRepository {
  private readonly resources = new Map<string, GrantEvidenceResource>();
  private readonly dependencies = new Map<string, GrantEvidenceDependency>();

  async createResource(resource: GrantEvidenceResource) {
    if (this.resources.has(resource.source.sourceId)) throw new Error("Evidence source already exists.");
    this.resources.set(resource.source.sourceId, clone(GrantEvidenceResourceSchema.parse(resource)));
    return clone(resource);
  }

  async listResources(documentId: string) {
    return [...this.resources.values()]
      .filter((item) => item.source.documentId === documentId && item.source.status !== "deleted")
      .sort((a, b) => b.source.createdAt.localeCompare(a.source.createdAt))
      .map(clone);
  }

  async getResource(documentId: string, sourceId: string) {
    const resource = this.resources.get(sourceId);
    return resource?.source.documentId === documentId ? clone(resource) : null;
  }

  async updateAuthorization(input: Parameters<GrantEvidenceRepository["updateAuthorization"]>[0]) {
    const resource = this.resources.get(input.sourceId);
    if (!resource || resource.source.documentId !== input.documentId) throw new Error("Evidence source not found.");
    if (resource.source.status !== "active") throw new Error("Evidence source is not active.");
    if (resource.authorization.revision !== input.expectedRevision) throw new Error("Evidence authorization revision conflict.");
    const authorization = GrantEvidenceAuthorizationSchema.parse({
      ...resource.authorization,
      revision: resource.authorization.revision + 1,
      permissions: input.permissions,
      allowedTaskIds: input.allowedTaskIds,
      expiresAt: input.expiresAt,
      revokedAt: undefined,
      updatedBy: input.actorId,
      updatedAt: input.updatedAt,
    });
    this.resources.set(input.sourceId, GrantEvidenceResourceSchema.parse({ ...resource, authorization }));
    return clone(authorization);
  }

  async revoke(input: Parameters<GrantEvidenceRepository["revoke"]>[0]) {
    const resource = this.resources.get(input.sourceId);
    if (!resource || resource.source.documentId !== input.documentId) throw new Error("Evidence source not found.");
    if (resource.authorization.revision !== input.expectedRevision) throw new Error("Evidence authorization revision conflict.");
    const denied = { read: false, index: false, sendRelevantExcerptToModel: false, useForReasoning: false, useForCitation: false };
    const next = GrantEvidenceResourceSchema.parse({
      source: { ...resource.source, status: "revoked", revokedAt: input.revokedAt, updatedAt: input.revokedAt },
      authorization: {
        ...resource.authorization,
        revision: resource.authorization.revision + 1,
        permissions: denied,
        revokedAt: input.revokedAt,
        updatedBy: input.actorId,
        updatedAt: input.revokedAt,
      },
      cards: resource.cards.map((card) => ({ ...card, status: "revoked" })),
    });
    this.resources.set(input.sourceId, next);
    for (const [id, dependency] of this.dependencies) {
      if (dependency.sourceId === input.sourceId && dependency.status === "active") {
        this.dependencies.set(id, GrantEvidenceDependencySchema.parse({ ...dependency, status: "evidence_revoked", updatedAt: input.revokedAt }));
      }
    }
    return clone(next);
  }

  async beginDeletion(input: Parameters<GrantEvidenceRepository["beginDeletion"]>[0]) {
    const resource = this.resources.get(input.sourceId);
    if (!resource || resource.source.documentId !== input.documentId) throw new Error("Evidence source not found.");
    if (resource.source.status === "deleted") return clone(resource);
    const next = GrantEvidenceResourceSchema.parse({
      source: { ...resource.source, status: "deletion_pending", revokedAt: resource.source.revokedAt ?? input.deletedAt, updatedAt: input.deletedAt },
      authorization: {
        ...resource.authorization,
        revision: resource.authorization.revision + 1,
        permissions: { read: false, index: false, sendRelevantExcerptToModel: false, useForReasoning: false, useForCitation: false },
        revokedAt: resource.authorization.revokedAt ?? input.deletedAt,
        updatedBy: input.actorId,
        updatedAt: input.deletedAt,
      },
      cards: [],
    });
    this.resources.set(input.sourceId, next);
    for (const [id, dependency] of this.dependencies) {
      if (dependency.sourceId === input.sourceId && dependency.status === "active") {
        this.dependencies.set(id, GrantEvidenceDependencySchema.parse({ ...dependency, status: "evidence_revoked", updatedAt: input.deletedAt }));
      }
    }
    return clone(next);
  }

  async completeDeletion(input: Parameters<GrantEvidenceRepository["completeDeletion"]>[0]) {
    const resource = this.resources.get(input.sourceId);
    if (!resource || resource.source.documentId !== input.documentId) throw new Error("Evidence source not found.");
    if (resource.source.status !== "deletion_pending" && resource.source.status !== "deleted") throw new Error("Evidence deletion has not begun.");
    const next = GrantEvidenceResourceSchema.parse({
      ...resource,
      source: { ...resource.source, status: "deleted", storage: undefined, deletedAt: input.deletedAt, updatedAt: input.deletedAt },
      cards: [],
    });
    this.resources.set(input.sourceId, next);
    return clone(next);
  }

  async registerDependency(dependency: GrantEvidenceDependency) {
    const parsed = GrantEvidenceDependencySchema.parse(dependency);
    this.dependencies.set(parsed.dependencyId, clone(parsed));
    return clone(parsed);
  }

  async listDependencies(documentId: string, sourceId: string) {
    return [...this.dependencies.values()]
      .filter((item) => item.documentId === documentId && item.sourceId === sourceId)
      .map(clone);
  }
}
