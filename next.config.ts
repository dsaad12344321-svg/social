import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
