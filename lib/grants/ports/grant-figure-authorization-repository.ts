import type { GrantFigureModelAuthorization } from "../domain/figure-assets.ts";

export interface GrantFigureAuthorizationRepository {
  getCurrent(documentId: string): Promise<GrantFigureModelAuthorization | null>;
  save(input: {
    documentId: string;
    expectedAuthorizationRevision: number;
    authorization: GrantFigureModelAuthorization;
  }): Promise<GrantFigureModelAuthorization>;
}
