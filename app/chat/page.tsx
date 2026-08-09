import { ChatShell } from "@/components/chat-shell";
import { isGrantWorkspaceEnabled } from "@/lib/grants/server/config";

export default function ChatPage() {
  return <ChatShell grantWorkspaceEnabled={isGrantWorkspaceEnabled()} />;
}
