// Server-only module. Do not import from client components or /api/chat route entry.

import type { ChatMessage } from "@/lib/ai/types";
import type { AttachmentInput } from "@/lib/uploads/types";

export type StructuredDocument = {
  fileName: string;
  text: string;
  truncated: boolean;
  originalLength: number;
};

export type ImageEvidence = {
  fileName: string;
  dataUrl: string;
  mimeType: string;
};

export type AnalysisEvidence = {
  documents: StructuredDocument[];
  images: ImageEvidence[];
};

export type AnalysisInput = {
  messages: ChatMessage[];
  userMessage: string;
  files: AttachmentInput[];
};

export type AnalysisResult = {
  messages: ChatMessage[];
  evidence: AnalysisEvidence;
  fileResults: AttachmentProcessingResult[];
};

export type AttachmentProcessingResult = {
  fileName: string;
  status: "ready" | "failed";
  kind?: "document" | "image";
  truncated?: boolean;
  error?: string;
  stage?: string;
};

export interface AnalysisWorkflow {
  run(input: AnalysisInput): Promise<AnalysisResult>;
}

export interface AnalysisEngine {
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}
