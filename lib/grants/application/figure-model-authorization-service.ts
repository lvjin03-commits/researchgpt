import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_GRANT_FIGURE_MODEL_PERMISSIONS,
  GrantFigureModelAuthorizationSchema,
  GrantFigureModelPermissionsSchema,
  type GrantFigureModelAuthorization,
  type GrantFigureModelPermissions,
  type GrantImportedFigureAsset,
} from "../domain/figure-assets.ts";
import type { GrantFigureAuthorizationRepository } from "../ports/grant-figure-authorization-repository.ts";
import { GrantRevisionService } from "./revision-service.ts";

export class GrantFigureAuthorizationConflictError extends Error {}
export class GrantFigureAuthorizationDeniedError extends Error {}

export const GrantFigureAuthorizationProjectionSchema = z.object({
  sourceRevisionId: z.string().uuid(),
  eligibleAssetIds: z.array(z.string().uuid()),
  authorization: GrantFigureModelAuthorizationSchema.nullable(),
  effectivePermissions: GrantFigureModelPermissionsSchema,
  requiresRenewal: z.boolean(),
}).strict().readonly();

export type GrantFigureAuthorizationProjection = z.infer<typeof GrantFigureAuthorizationProjectionSchema>;

export class GrantFigureModelAuthorizationService {
  private readonly revisions: GrantRevisionService;
  private readonly repository: GrantFigureAuthorizationRepository;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    revisions: GrantRevisionService,
    repository: GrantFigureAuthorizationRepository,
    createId: () => string = randomUUID,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.revisions = revisions;
    this.repository = repository;
    this.createId = createId;
    this.now = now;
  }

  async getCurrent(documentId: string): Promise<GrantFigureAuthorizationProjection> {
    const aggregate = await this.revisions.getDocument(documentId);
    const eligibleAssetIds = await this.eligibleAssetIds(documentId, aggregate.currentRevision.snapshot);
    const authorization = await this.repository.getCurrent(documentId);
    const active = this.isActive(authorization, aggregate.currentRevision.revisionId, eligibleAssetIds);
    return GrantFigureAuthorizationProjectionSchema.parse({
      sourceRevisionId: aggregate.currentRevision.revisionId,
      eligibleAssetIds,
      authorization,
      effectivePermissions: active ? authorization!.permissions : DEFAULT_GRANT_FIGURE_MODEL_PERMISSIONS,
      requiresRenewal: Boolean(authorization) && authorization!.sourceRevisionId !== aggregate.currentRevision.revisionId,
    });
  }

  async authorize(input: {
    documentId: string;
    expectedAuthorizationRevision: number;
    allowedAssetIds: string[];
    permissions: GrantFigureModelPermissions;
    expiresAt?: string | null;
    actorId: string;
  }): Promise<GrantFigureAuthorizationProjection> {
    const projection = await this.getCurrent(input.documentId);
    const permissions = GrantFigureModelPermissionsSchema.parse(input.permissions);
    const allowedAssetIds = [...new Set(input.allowedAssetIds)];
    if (allowedAssetIds.length === 0 || allowedAssetIds.some((assetId) => !projection.eligibleAssetIds.includes(assetId))) {
      throw new GrantFigureAuthorizationDeniedError("Only images in the current grant revision may be authorized.");
    }
    const timestamp = this.now();
    const previous = projection.authorization;
    const authorization = GrantFigureModelAuthorizationSchema.parse({
      authorizationId: previous?.authorizationId ?? this.createId(),
      documentId: input.documentId,
      sourceRevisionId: projection.sourceRevisionId,
      authorizationRevision: input.expectedAuthorizationRevision + 1,
      allowedAssetIds,
      permissions,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      updatedBy: input.actorId,
      updatedAt: timestamp,
    });
    await this.save(input.documentId, input.expectedAuthorizationRevision, authorization);
    return this.getCurrent(input.documentId);
  }

  async revoke(input: {
    documentId: string;
    expectedAuthorizationRevision: number;
    actorId: string;
  }): Promise<GrantFigureAuthorizationProjection> {
    const projection = await this.getCurrent(input.documentId);
    if (!projection.authorization) return projection;
    const timestamp = this.now();
    const authorization = GrantFigureModelAuthorizationSchema.parse({
      ...projection.authorization,
      sourceRevisionId: projection.sourceRevisionId,
      authorizationRevision: input.expectedAuthorizationRevision + 1,
      allowedAssetIds: projection.eligibleAssetIds.length > 0
        ? projection.eligibleAssetIds
        : projection.authorization.allowedAssetIds,
      permissions: DEFAULT_GRANT_FIGURE_MODEL_PERMISSIONS,
      revokedAt: timestamp,
      updatedBy: input.actorId,
      updatedAt: timestamp,
    });
    await this.save(input.documentId, input.expectedAuthorizationRevision, authorization);
    return this.getCurrent(input.documentId);
  }

  async materializeCurrentForSemanticDiagnosis(documentId: string): Promise<{
    authorization: GrantFigureModelAuthorization;
    assets: GrantImportedFigureAsset[];
  }> {
    const projection = await this.getCurrent(documentId);
    const authorization = projection.authorization;
    if (!authorization || !projection.effectivePermissions.sendImageToModel
      || !projection.effectivePermissions.useForSemanticDiagnosis) {
      throw new GrantFigureAuthorizationDeniedError("Current image authorization does not permit semantic diagnosis.");
    }
    const assets = await this.revisions.listImportedFigureAssets(documentId);
    const allowed = new Set(authorization.allowedAssetIds);
    return { authorization, assets: assets.filter((asset) => allowed.has(asset.assetId)) };
  }

  private async eligibleAssetIds(documentId: string, snapshot: { nodes: Array<{ nodeType: string; content: unknown }> }) {
    const referenced = new Set(snapshot.nodes.flatMap((node) =>
      node.nodeType === "figure" && typeof node.content === "object" && node.content !== null && "assetId" in node.content
        ? [String((node.content as { assetId: unknown }).assetId)]
        : []));
    const assets = await this.revisions.listImportedFigureAssets(documentId);
    return assets.filter((asset) => referenced.has(asset.assetId)).map((asset) => asset.assetId);
  }

  private isActive(
    authorization: GrantFigureModelAuthorization | null,
    sourceRevisionId: string,
    eligibleAssetIds: string[],
  ) {
    if (!authorization || authorization.revokedAt || authorization.sourceRevisionId !== sourceRevisionId) return false;
    if (authorization.expiresAt && Date.parse(authorization.expiresAt) <= Date.parse(this.now())) return false;
    const eligible = new Set(eligibleAssetIds);
    return authorization.allowedAssetIds.every((assetId) => eligible.has(assetId));
  }

  private async save(documentId: string, expectedAuthorizationRevision: number, authorization: GrantFigureModelAuthorization) {
    try {
      return await this.repository.save({ documentId, expectedAuthorizationRevision, authorization });
    } catch (error) {
      if (/figure authorization revision conflict/i.test(error instanceof Error ? error.message : "")) {
        throw new GrantFigureAuthorizationConflictError("Image authorization changed; reload before updating.");
      }
      throw error;
    }
  }
}
