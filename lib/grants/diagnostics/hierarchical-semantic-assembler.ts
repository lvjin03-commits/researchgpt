import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  GrantArgumentMapProviderResultV1Schema,
  GrantArgumentMapV1Schema,
  type GrantArgumentMapProviderResultV1,
  type GrantArgumentMapV1,
} from "./hierarchical-semantic-contracts.ts";

export class GrantArgumentMapReferenceError extends Error {
  readonly invalidPaths: string[];

  constructor(invalidPaths: string[]) {
    super("ArgumentMap referenced a location outside the frozen diagnostic scope.");
    this.name = "GrantArgumentMapReferenceError";
    this.invalidPaths = invalidPaths;
  }
}

export function assembleGrantArgumentMapV1(input: {
  sourceRevisionId: string;
  providerResult: GrantArgumentMapProviderResultV1;
  locationByRef: ReadonlyMap<string, { sectionId: string; nodeId: string }>;
}): GrantArgumentMapV1 {
  const providerResult = GrantArgumentMapProviderResultV1Schema.parse(input.providerResult);
  const invalidPaths: string[] = [];
  const resolve = (references: string[], path: string) => references.flatMap((locationRef, index) => {
    const location = input.locationByRef.get(locationRef);
    if (!location) {
      invalidPaths.push(`${path}.${index}`);
      return [];
    }
    return [location];
  });
  const candidate = {
    schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion,
    sourceRevisionId: input.sourceRevisionId,
    modules: providerResult.modules.map((module, index) => ({
      role: module.role,
      presence: module.presence,
      statement: module.statement,
      sourceLocations: resolve(module.sourceLocationRefs, `modules.${index}.sourceLocationRefs`),
    })),
    relations: providerResult.relations.map((relation, index) => ({
      fromRole: relation.fromRole,
      toRole: relation.toRole,
      relation: relation.relation,
      sourceLocations: resolve(relation.sourceLocationRefs, `relations.${index}.sourceLocationRefs`),
    })),
  };
  if (invalidPaths.length > 0) throw new GrantArgumentMapReferenceError(invalidPaths);
  return GrantArgumentMapV1Schema.parse(candidate);
}
