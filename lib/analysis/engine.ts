// Server-only module. Do not import from client components or /api/chat route entry.

import { DefaultAnalysisWorkflow } from "./workflow";
import type {
  AnalysisEngine,
  AnalysisInput,
  AnalysisResult,
  AnalysisWorkflow,
} from "./types";

export class DefaultAnalysisEngine implements AnalysisEngine {
  constructor(private readonly workflow: AnalysisWorkflow) {}

  analyze(input: AnalysisInput): Promise<AnalysisResult> {
    return this.workflow.run(input);
  }
}

export function createDefaultAnalysisEngine(): AnalysisEngine {
  return new DefaultAnalysisEngine(new DefaultAnalysisWorkflow());
}
