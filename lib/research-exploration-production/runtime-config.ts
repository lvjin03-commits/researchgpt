import { z } from "zod";

const RuntimeConfigSchema = z.object({
  projectId: z.string().trim().min(1),
  projectNumber: z.string().trim().regex(/^\d+$/),
  region: z.string().trim().min(1),
  jobName: z.string().trim().min(1),
  workloadIdentityPoolId: z.string().trim().min(1),
  workloadIdentityProviderId: z.string().trim().min(1),
  serviceAccountEmail: z.string().trim().email(),
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
    projectNumber: environment.GOOGLE_CLOUD_PROJECT_NUMBER,
    region: environment.GOOGLE_CLOUD_RUN_REGION,
    jobName: environment.STORM_CLOUD_RUN_JOB_NAME,
    workloadIdentityPoolId: environment.GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_ID,
    workloadIdentityProviderId:
      environment.GOOGLE_CLOUD_WORKLOAD_IDENTITY_PROVIDER_ID,
    serviceAccountEmail: environment.GOOGLE_CLOUD_SERVICE_ACCOUNT_EMAIL,
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
