import { createHash } from "node:crypto";
import {
  ResearchExplorationInputSchema,
  ResearchExplorationVersionSnapshotSchema,
  type ResearchExplorationInput,
  type ResearchExplorationVersionSnapshot,
} from "./contracts.ts";

function sortedUnique(values: ReadonlyArray<string>): string[] {
  return [...new Set(values.map((value) => value.normalize("NFKC").trim()))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export function createResearchExplorationFingerprint(input: {
  request: ResearchExplorationInput;
  versions: ResearchExplorationVersionSnapshot;
}): string {
  const request = ResearchExplorationInputSchema.parse(input.request);
  const versions = ResearchExplorationVersionSnapshotSchema.parse(input.versions);
  const fingerprintPayload = {
    topic: request.topic.normalize("NFKC").trim(),
    purpose: request.purpose,
    language: request.language,
    scope: {
      timeRange: request.scope.timeRange,
      disciplines: sortedUnique(request.scope.disciplines),
      excludedTopics: sortedUnique(request.scope.excludedTopics),
    },
    sourcePolicy: {
      useWeb: request.sourcePolicy.useWeb,
      useUserDocuments: request.sourcePolicy.useUserDocuments,
      userResourceIds: sortedUnique(request.sourcePolicy.userResourceIds),
    },
    limits: request.limits,
    modelProfile: request.modelProfile,
    userResourceSnapshotHash: request.userResourceSnapshotHash,
    versions,
  };
  return createHash("sha256")
    .update(JSON.stringify(fingerprintPayload), "utf8")
    .digest("hex");
}
