export function createGrantEvidenceObjectPath(ownerId: string, documentId: string, sourceId: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(ownerId) || !uuid.test(documentId) || !uuid.test(sourceId)) {
    throw new Error("Grant evidence object identity is invalid.");
  }
  return `grants/${ownerId}/documents/${documentId}/evidence/${sourceId}/original`;
}
