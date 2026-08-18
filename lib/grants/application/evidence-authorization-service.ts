import type {
  GrantEvidencePermissions,
  GrantEvidenceResource,
} from "../evidence/contracts.ts";
import { GrantEvidencePermissionsSchema } from "../evidence/contracts.ts";
import type { GrantEvidenceRepository } from "../ports/grant-evidence-repository.ts";

export class GrantEvidenceNotFoundError extends Error {}
export class GrantEvidenceAuthorizationConflictError extends Error {}
export class GrantEvidenceUseDeniedError extends Error {
  readonly sourceId: string;

  constructor(sourceId: string, message: string) {
    super(message);
    this.name = "GrantEvidenceUseDeniedError";
    this.sourceId = sourceId;
  }
}

export type GrantEvidenceUse = "model" | "reasoning" | "citation";

export class GrantEvidenceAuthorizationService {
  private readonly repository: GrantEvidenceRepository;
  private readonly now: () => string;

  constructor(
    repository: GrantEvidenceRepository,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.repository = repository;
    this.now = now;
  }

  async update(input: {
    documentId: string;
    sourceId: string;
    expectedRevision: number;
    permissions: GrantEvidencePermissions;
    allowedTaskIds?: string[];
    expiresAt?: string;
    actorId: string;
  }) {
    const permissions = GrantEvidencePermissionsSchema.parse(input.permissions);
    try {
      return await this.repository.updateAuthorization({
        ...input,
        permissions,
        updatedAt: this.now(),
      });
    } catch (error) {
      if (/authorization revision conflict/i.test(error instanceof Error ? error.message : "")) {
        throw new GrantEvidenceAuthorizationConflictError("Evidence authorization changed; reload before updating.");
      }
      throw error;
    }
  }

  async revoke(input: {
    documentId: string;
    sourceId: string;
    expectedRevision: number;
    actorId: string;
  }) {
    try {
      return await this.repository.revoke({ ...input, revokedAt: this.now() });
    } catch (error) {
      if (/authorization revision conflict/i.test(error instanceof Error ? error.message : "")) {
        throw new GrantEvidenceAuthorizationConflictError("Evidence authorization changed; reload before revoking.");
      }
      throw error;
    }
  }

  async materializeCurrent(input: {
    documentId: string;
    sourceIds: string[];
    taskId?: string;
    use: GrantEvidenceUse;
  }): Promise<GrantEvidenceResource[]> {
    const now = Date.parse(this.now());
    const resources: GrantEvidenceResource[] = [];
    for (const sourceId of [...new Set(input.sourceIds)]) {
      const resource = await this.repository.getResource(input.documentId, sourceId);
      if (!resource) throw new GrantEvidenceNotFoundError(`Evidence source ${sourceId} was not found.`);
      const authorization = resource.authorization;
      const allowed = input.use === "model"
        ? authorization.permissions.sendRelevantExcerptToModel
        : input.use === "reasoning"
          ? authorization.permissions.useForReasoning
          : authorization.permissions.useForCitation;
      const taskAllowed = !authorization.allowedTaskIds
        || (!!input.taskId && authorization.allowedTaskIds.includes(input.taskId));
      const notExpired = !authorization.expiresAt || Date.parse(authorization.expiresAt) > now;
      if (
        resource.source.status !== "active"
        || authorization.revokedAt
        || !allowed
        || !taskAllowed
        || !notExpired
      ) {
        throw new GrantEvidenceUseDeniedError(sourceId, "Current evidence authorization does not permit this use.");
      }
      resources.push(resource);
    }
    return resources;
  }

  async inspectCurrent(input: {
    documentId: string;
    sourceId: string;
    taskId?: string;
    uses: GrantEvidenceUse[];
  }): Promise<{ resource: GrantEvidenceResource | null; status: "current" | "revoked" | "expired" }> {
    const resource = await this.repository.getResource(input.documentId, input.sourceId);
    if (!resource) return { resource: null, status: "revoked" };
    const authorization = resource.authorization;
    if (authorization.expiresAt && Date.parse(authorization.expiresAt) <= Date.parse(this.now())) {
      return { resource, status: "expired" };
    }
    const permissions = input.uses.every((use) => use === "model"
      ? authorization.permissions.sendRelevantExcerptToModel
      : use === "reasoning"
        ? authorization.permissions.useForReasoning
        : authorization.permissions.useForCitation);
    const taskAllowed = !authorization.allowedTaskIds
      || (!!input.taskId && authorization.allowedTaskIds.includes(input.taskId));
    if (resource.source.status !== "active" || authorization.revokedAt || !permissions || !taskAllowed) {
      return { resource, status: "revoked" };
    }
    return { resource, status: "current" };
  }

  async listCurrentForModelReasoning(input: {
    documentId: string;
    taskId?: string;
  }): Promise<GrantEvidenceResource[]> {
    const resources = await this.repository.listResources(input.documentId);
    const now = Date.parse(this.now());
    const sourceIds = resources
      .filter((resource) =>
        resource.source.status === "active"
        && resource.source.sensitivity !== "highly_sensitive"
        && resource.authorization.permissions.sendRelevantExcerptToModel
        && resource.authorization.permissions.useForReasoning
        && !resource.authorization.revokedAt
        && (!resource.authorization.expiresAt || Date.parse(resource.authorization.expiresAt) > now)
        && (!resource.authorization.allowedTaskIds
          || (!!input.taskId && resource.authorization.allowedTaskIds.includes(input.taskId)))
      )
      .map((resource) => resource.source.sourceId);
    if (sourceIds.length === 0) return [];
    const sendable = await this.materializeCurrent({ ...input, sourceIds, use: "model" });
    await this.materializeCurrent({ ...input, sourceIds, use: "reasoning" });
    return sendable;
  }
}
