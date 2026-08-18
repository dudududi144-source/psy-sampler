import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
  allowedDevOrigins: ["*.z.ai", "*.space-z.ai"],
};
export default nextConfig;
