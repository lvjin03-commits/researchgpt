import { z } from "zod";

const RuntimeConfigSchema = z.object({
  projectId: z.string().trim().min(1),
  region: z.string().trim().min(1),
  jobName: z.string().trim().min(1),
  serviceAccountJson: z.string().trim().min(1),
  requestProvider: z.string().trim().min(1),
  requestModel: z.string().trim().min(1),
  sampleRateBasisPoints: z.number().int().min(0).max(10_000),
  maximumConcurrentExecutions: z.number().int().min(1).max(100),
});

export type ResearchExplorationProductionConfig = z.infer<
  typeof RuntimeConfigSchema
>;

export function requireResearchExplorationProductionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ResearchExplorationProductionConfig {
  return RuntimeConfigSchema.parse({
    projectId: environment.GOOGLE_CLOUD_PROJECT_ID,
    region: environment.GOOGLE_CLOUD_RUN_REGION,
    jobName: environment.STORM_CLOUD_RUN_JOB_NAME,
    serviceAccountJson: environment.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON,
    requestProvider: environment.STORM_REQUEST_PROVIDER ?? "deepseek",
    requestModel: environment.STORM_REQUEST_MODEL ?? "deepseek-chat",
    sampleRateBasisPoints: Number(
      environment.STORM_SHADOW_SAMPLE_RATE_BASIS_POINTS ?? "10000",
    ),
    maximumConcurrentExecutions: Number(
      environment.STORM_SHADOW_MAX_CONCURRENT ?? "2",
    ),
  });
}
