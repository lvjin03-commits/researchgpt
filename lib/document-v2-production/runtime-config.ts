const REQUIRED_WORKER_ENV = [
  "CRON_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export type DocumentV2RequiredEnvironmentVariable =
  (typeof REQUIRED_WORKER_ENV)[number];

export type DocumentV2RuntimeReadiness = {
  publicEnabled: boolean;
  workerReady: boolean;
  missing: DocumentV2RequiredEnvironmentVariable[];
  invalid: string[];
};

export class DocumentV2ConfigurationError extends Error {
  readonly code = "document_v2_configuration_invalid";

  constructor(
    readonly missing: DocumentV2RequiredEnvironmentVariable[],
    readonly invalid: string[],
  ) {
    super(
      [
        missing.length ? `Missing: ${missing.join(", ")}` : "",
        invalid.length ? `Invalid: ${invalid.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
    this.name = "DocumentV2ConfigurationError";
  }
}

export class DocumentV2PublicRuntimeDisabledError extends Error {
  readonly code = "document_v2_runtime_disabled";

  constructor() {
    super("The public document-v2 runtime is disabled.");
    this.name = "DocumentV2PublicRuntimeDisabledError";
  }
}

function publicRuntimeEnabled(env: NodeJS.ProcessEnv): boolean {
  const explicitPublicFlag = env.DOCUMENT_V2_PUBLIC_ENABLED?.trim();
  if (explicitPublicFlag !== undefined && explicitPublicFlag !== "") {
    return explicitPublicFlag === "true";
  }
  return env.DOCUMENT_V2_RUNTIME_ENABLED === "true";
}

export function inspectDocumentV2Runtime(
  env: NodeJS.ProcessEnv = process.env,
): DocumentV2RuntimeReadiness {
  const missing = REQUIRED_WORKER_ENV.filter((name) => !env[name]?.trim());
  const invalid: string[] = [];
  const secret = env.CRON_SECRET?.trim();

  if (secret && secret.length < 32) {
    invalid.push("CRON_SECRET_TOO_SHORT");
  }

  return {
    publicEnabled: publicRuntimeEnabled(env),
    workerReady: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}

export function requireDocumentV2WorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
) {
  const readiness = inspectDocumentV2Runtime(env);
  if (!readiness.workerReady) {
    throw new DocumentV2ConfigurationError(
      readiness.missing,
      readiness.invalid,
    );
  }

  return {
    cronSecret: env.CRON_SECRET!.trim(),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    openAiApiKey: env.OPENAI_API_KEY?.trim(),
  };
}

export function requireDocumentV2PublicRuntime(
  env: NodeJS.ProcessEnv = process.env,
) {
  const readiness = inspectDocumentV2Runtime(env);
  if (!readiness.publicEnabled) {
    throw new DocumentV2PublicRuntimeDisabledError();
  }
  return requireDocumentV2WorkerConfig(env);
}
