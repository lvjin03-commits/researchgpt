import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "unpdf", "@napi-rs/canvas"],
};

export default nextConfig;
