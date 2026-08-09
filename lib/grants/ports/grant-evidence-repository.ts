import type {
  GrantEvidenceAuthorization,
  GrantEvidenceDependency,
  GrantEvidencePermissions,
  GrantEvidenceResource,
} from "../evidence/contracts.ts";

export interface GrantEvidenceRepository {
  createResource(resource: GrantEvidenceResource): Promise<GrantEvidenceResource>;
  listResources(documentId: string): Promise<GrantEvidenceResource[]>;
  getResource(documentId: string, sourceId: string): Promise<GrantEvidenceResource | null>;
  updateAuthorization(input: {
    documentId: string;
    sourceId: string;
    expectedRevision: number;
    permissions: GrantEvidencePermissions;
    allowedTaskIds?: string[];
    expiresAt?: string;
    actorId: string;
    updatedAt: string;
  }): Promise<GrantEvidenceAuthorization>;
  revoke(input: {
    documentId: string;
    sourceId: string;
    expectedRevision: number;
    actorId: string;
    revokedAt: string;
  }): Promise<GrantEvidenceResource>;
  beginDeletion(input: {
    documentId: string;
    sourceId: string;
    actorId: string;
    deletedAt: string;
  }): Promise<GrantEvidenceResource>;
  completeDeletion(input: {
    documentId: string;
    sourceId: string;
    actorId: string;
    deletedAt: string;
  }): Promise<GrantEvidenceResource>;
  registerDependency(dependency: GrantEvidenceDependency): Promise<GrantEvidenceDependency>;
  listDependencies(documentId: string, sourceId: string): Promise<GrantEvidenceDependency[]>;
}
