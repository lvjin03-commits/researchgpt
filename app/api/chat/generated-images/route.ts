import { requireChatUser } from "@/lib/chat/server/errors";
import { createClient } from "@/lib/supabase/server";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";

export const runtime = "nodejs";

function safePath(value: string | null): string {
  return (value ?? "").trim().replace(/^\/+/, "");
}

export async function GET(request: Request) {
  const user = await requireChatUser();
  const { searchParams } = new URL(request.url);
  const path = safePath(searchParams.get("path"));
  const download = searchParams.get("download") === "1";

  if (
    !path ||
    !path.startsWith(`${user.id}/generated-images/`) ||
    !path.endsWith(".png")
  ) {
    return Response.json({ error: "Invalid image path." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .download(path);

  if (error || !data) {
    return Response.json({ error: "Generated image not found." }, { status: 404 });
  }

  return new Response(data, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(
        path.split("/").pop() ?? "researchgpt-image.png",
      )}"`,
    },
  });
}
