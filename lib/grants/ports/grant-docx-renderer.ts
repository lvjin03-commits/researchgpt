import type { CanonicalGrantSnapshot, TemplateSnapshot } from "../domain/contracts.ts";
import type { GrantDocxArtifact } from "../exports/contracts.ts";

export interface GrantDocxRenderer {
  render(input: {
    documentId: string;
    revisionId: string;
    snapshot: CanonicalGrantSnapshot;
    templateSnapshot: TemplateSnapshot;
  }): Promise<GrantDocxArtifact>;
}
