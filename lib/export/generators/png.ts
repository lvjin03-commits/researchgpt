import sharp from "sharp";
import { generateArtifactSvg } from "@/lib/export/generators/svg";

export async function generateArtifactPngBuffer(
  title: string,
  content: string,
): Promise<Buffer> {
  const svg = generateArtifactSvg(title, content);
  return sharp(Buffer.from(svg, "utf8"), { density: 144 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
