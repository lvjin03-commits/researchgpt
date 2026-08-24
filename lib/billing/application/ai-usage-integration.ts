import { z } from "zod";
import { AiUsageEnvelopeSchema, type AiUsageEnvelope } from "../../ai/billable-usage.ts";

export const AiBillingIntegrationModeSchema = z.enum(["disabled", "meter_only"]);
export type AiBillingIntegrationMode = z.infer<typeof AiBillingIntegrationModeSchema>;

export interface AiUsageEventSink {
  append(ownerId: string, envelope: AiUsageEnvelope): Promise<void>;
}

export function resolveAiBillingIntegrationMode(
  value = process.env.AI_POINT_BILLING_MODE,
): AiBillingIntegrationMode {
  const normalized = value?.trim() || "disabled";
  return AiBillingIntegrationModeSchema.parse(normalized);
}

export class AiUsageIntegration {
  private readonly sink: AiUsageEventSink;
  readonly mode: AiBillingIntegrationMode;
  private readonly onAppendFailure: (error: unknown) => void;

  constructor(
    sink: AiUsageEventSink,
    mode: AiBillingIntegrationMode = resolveAiBillingIntegrationMode(),
    onAppendFailure: (error: unknown) => void = (error) => {
      console.warn("[point-billing] Standardized usage event was not persisted:", error);
    },
  ) {
    this.sink = sink;
    this.mode = mode;
    this.onAppendFailure = onAppendFailure;
  }

  async record(ownerId: string, rawEnvelope: AiUsageEnvelope): Promise<void> {
    if (this.mode === "disabled") return;
    const envelope = AiUsageEnvelopeSchema.parse(rawEnvelope);
    try {
      await this.sink.append(ownerId, envelope);
    } catch (error) {
      this.onAppendFailure(error);
    }
  }
}
