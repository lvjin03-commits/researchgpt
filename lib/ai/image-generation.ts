// Server-only module. Do not import from client components.

import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/errors";
import type { ChatMessage } from "@/lib/ai/types";

const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_IMAGE_SIZE = "1536x864";
const DEFAULT_IMAGE_QUALITY = "high";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new AIProviderError("OPENAI_API_KEY is not configured", {
      statusCode: 500,
      provider: "openai",
    });
  }

  return new OpenAI({ apiKey });
}

function textFromMessage(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

export function isGptImageRequest(query: string): boolean {
  const text = query.trim();
  if (!text) return false;

  const wantsPolishedImage =
    /(像\s*(?:GPT|ChatGPT)|同等质量|高质量|专业|精美|好看|成品|可直接用|直接用于|海报感|海报式|真正像海报|不要草稿|不是草稿).{0,28}(图片|图像|图|海报|插画|信息图|配图|PNG|JPG|JPEG|WEBP|visual|image|infographic|poster)|(?:图片|图像|海报|插画|信息图|科研插图|配图|PNG|JPG|JPEG|WEBP).{0,28}(像\s*(?:GPT|ChatGPT)|同等质量|高质量|专业|精美|好看|成品|可直接用|直接用于|不要草稿|不是草稿)/i.test(
      text,
    );
  const wantsOnePageVisual =
    /(总结|整理|浓缩|压缩|归纳|做|生成|制作|创建|设计|输出).{0,20}(一张图|一张图片|一张海报|一页图|海报图|总览图|全景图|概览图|信息图|说明图|视觉图|PNG|JPG|JPEG|WEBP)/i.test(
      text,
    );
  const wantsRasterImage =
    /(生成|制作|创建|设计|画|绘制|总结成|整理成|转成|做成|输出).{0,24}(图片|图像|插画|海报|封面图|概念图|信息图|宣传图|科研插图|配图|PNG|JPG|JPEG|WEBP)|(?:generate|create|draw|design|make).{0,24}(image|illustration|poster|cover|infographic|visual)/i.test(
      text,
    );
  const negatesStructure =
    /(不要|不想要|不是|别|不要再|不要生成).{0,8}(流程图|鱼骨图|时间轴|结构图|框架图|思维导图|svg|可编辑|flowchart|fishbone|timeline|framework)/i.test(
      text,
    );
  const explicitlyWantsEditableStructure =
    /(可编辑|SVG|svg|网页内|结构图|流程图|鱼骨图|时间轴|技术路线图|框架图|思维导图|柱状图|折线图|饼图|散点图|热图|flowchart|fishbone|ishikawa|timeline|framework|mind ?map|bar chart|line chart|pie chart|scatter|heatmap)/i.test(
      text,
    ) && !negatesStructure;

  if (wantsPolishedImage || wantsOnePageVisual) return true;

  return wantsRasterImage && !explicitlyWantsEditableStructure;
}

export function buildImagePrompt(messages: ChatMessage[]): string {
  const visibleMessages = messages
    .filter((message) => message.role !== "system")
    .slice(-8)
    .map((message) => {
      const role = message.role === "user" ? "User" : "Assistant";
      return `${role}: ${compact(textFromMessage(message), 1800)}`;
    })
    .filter((line) => line.trim().length > 8)
    .join("\n\n");

  return [
    "Create a high-quality scientific visual image for ResearchGPT.",
    "The user wants a polished raster image, not a generic webpage card or ASCII diagram.",
    "This must be a finished visual asset, similar to a polished ChatGPT-generated infographic image, not a rendered HTML card.",
    "",
    "Design requirements:",
    "- 16:9 landscape composition, suitable for a research report or academic presentation.",
    "- Clean scientific SaaS style, refined layout, strong hierarchy, restrained colors, readable text, and enough whitespace.",
    "- Convert the core idea into a visual narrative with modules, arrows, icons, evidence blocks, or spatial grouping as appropriate.",
    "- Keep all labels concise and large enough to read in a slide.",
    "- Prefer a poster-like one-page composition when the user asks to summarize everything into one image.",
    "- Avoid dense paragraphs, decorative clutter, tiny text, random stock-photo style, and irrelevant imagery.",
    "- Avoid a plain sequence of rectangular web cards unless the user explicitly requested a webpage mockup.",
    "- If Chinese is used in the user's request or context, use Chinese labels.",
    "- The image should look like a finished professional infographic that can be inserted directly into PPT or Word.",
    "",
    "Conversation context and user request:",
    visibleMessages,
  ].join("\n");
}

export async function generateResearchImage(
  messages: ChatMessage[],
  userId: string,
  signal?: AbortSignal,
): Promise<{
  model: string;
  mimeType: "image/png";
  buffer: Buffer;
}> {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
  const size = process.env.OPENAI_IMAGE_SIZE?.trim() || DEFAULT_IMAGE_SIZE;
  const quality =
    process.env.OPENAI_IMAGE_QUALITY?.trim() || DEFAULT_IMAGE_QUALITY;

  const response = await client.images.generate(
    {
      model,
      prompt: buildImagePrompt(messages),
      n: 1,
      size,
      quality: quality as "low" | "medium" | "high" | "auto",
      output_format: "png",
      background: "auto",
      user: userId,
    },
    { signal },
  );

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new AIProviderError("Image generation returned no image data.", {
      statusCode: 502,
      provider: "openai",
    });
  }

  return {
    model,
    mimeType: "image/png",
    buffer: Buffer.from(b64, "base64"),
  };
}
