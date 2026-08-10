import { createHash } from "node:crypto";

export const GRANT_DIAGNOSTIC_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export type GrantDiagnosticImageMediaType = typeof GRANT_DIAGNOSTIC_IMAGE_MEDIA_TYPES[number];

export type GrantDiagnosticImagePayload = {
  imageRef: string;
  locationRef: string;
  caption: string | null;
  mediaType: GrantDiagnosticImageMediaType;
  dataUrl: string;
};

export type GrantDiagnosticImageCoverageReason =
  | "no_figures_in_scope"
  | "not_authorized"
  | "authorization_changed"
  | "unsupported_media_type"
  | "image_too_large"
  | "image_capacity_limit"
  | "asset_unavailable";

export type GrantDiagnosticImageCoverage = {
  mode: "text_only" | "multimodal";
  candidateCount: number;
  authorizedCount: number;
  suppliedCount: number;
  omittedCount: number;
  reasons: GrantDiagnosticImageCoverageReason[];
  imageScopeFingerprint: string;
};

export type GrantDiagnosticImageAdmission = {
  images: GrantDiagnosticImagePayload[];
  coverage: GrantDiagnosticImageCoverage;
};

export type GrantDiagnosticImageAdmissionProvider = () => Promise<GrantDiagnosticImageAdmission>;

export function grantDiagnosticImageScopeFingerprint(input: Array<{
  imageRef: string;
  locationRef: string;
  contentHash: string;
}>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function textOnlyGrantDiagnosticImageAdmission(input: {
  candidateCount: number;
  authorizedCount?: number;
  reasons: GrantDiagnosticImageCoverageReason[];
}): GrantDiagnosticImageAdmission {
  return {
    images: [],
    coverage: {
      mode: "text_only",
      candidateCount: input.candidateCount,
      authorizedCount: input.authorizedCount ?? 0,
      suppliedCount: 0,
      omittedCount: input.candidateCount,
      reasons: [...new Set(input.reasons)],
      imageScopeFingerprint: grantDiagnosticImageScopeFingerprint([]),
    },
  };
}

