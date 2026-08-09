import type { GrantChecker } from "./checker.ts";
import { GrantCitationSupportChecker } from "./citation-support-checker.ts";
import { GrantRepeatedContentChecker } from "./repeated-content-checker.ts";
import { GrantStructuralCompletenessChecker } from "./structural-completeness-checker.ts";
import { GrantTerminologyConsistencyChecker } from "./terminology-consistency-checker.ts";

export function createDefaultGrantCheckers(): GrantChecker[] {
  return [
    new GrantStructuralCompletenessChecker(),
    new GrantCitationSupportChecker(),
    new GrantRepeatedContentChecker(),
    new GrantTerminologyConsistencyChecker(),
  ];
}
