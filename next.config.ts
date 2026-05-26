import type { NextConfig } from "next";
import path from "path";

const isE2eBuild = process.env.NEXT_E2E === "1";

const nextConfig: NextConfig = {
  // Keep Playwright builds isolated from local dev servers.
  distDir: isE2eBuild ? ".next-e2e" : ".next",
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
