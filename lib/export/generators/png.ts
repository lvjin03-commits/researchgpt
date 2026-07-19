import sharp from "sharp";
import { generateArtifactSvg } from "@/lib/export/generators/svg";
import type { ArtifactTemplateId } from "@/lib/export/artifact-planner";

export async function generateArtifactPngBuffer(
  title: string,
  content: string,
  templateId: ArtifactTemplateId = "academic",
): Promise<Buffer> {
  const svg = generateArtifactSvg(title, content, templateId);
  return sharp(Buffer.from(svg, "utf8"), { density: 144 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
