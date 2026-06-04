import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
  // pdf-parse uses fs/path - mark as server-only
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
