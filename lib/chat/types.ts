import type { ChatRole } from "@/lib/ai/types";
import type { AttachmentKind } from "@/lib/uploads/constants";

export type DisplayAttachment = {
  name: string;
  kind: AttachmentKind;
};

export type DisplayChatMessage = {
  role: ChatRole;
  content: string;
  attachments?: DisplayAttachment[];
};
