import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import { REVIEW_MODEL_IDS } from "@/lib/literature/review/constants";
import type { ReviewModel } from "@/lib/literature/review/types";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { generatePresentationDeckFromOutline } from "@/lib/literature/server/review-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireLiteratureUser();
    const body = (await request.json()) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const outline = typeof body.outline === "string" ? body.outline.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";

    if (!title) throw new LiteratureError("请填写PPT标题。", 400);
    if (outline.length < 20) {
      throw new LiteratureError("请提供更完整的PPT大纲。", 400);
    }
    if (outline.length > 60_000) {
      throw new LiteratureError("PPT大纲过长，请控制在60,000字符以内。", 413);
    }
    if (!REVIEW_MODEL_IDS.includes(model as ReviewModel)) {
      throw new LiteratureError("请选择有效的AI模型。", 400);
    }

    const deck = await generatePresentationDeckFromOutline({
      title,
      outline,
      model: model as ReviewModel,
      signal: request.signal,
    });
    return Response.json({ deck });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof AIProviderError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("[presentation] outline generation failed:", error);
    return Response.json({ error: "生成PPT方案失败。" }, { status: 500 });
  }
}
