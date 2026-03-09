import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["youtube-dl-exec"],
  outputFileTracingIncludes: {
    "/api/demo": ["./node_modules/youtube-dl-exec/bin/yt-dlp"],
    "/api/jobs": ["./node_modules/youtube-dl-exec/bin/yt-dlp"],
  },
};

export default nextConfig;
