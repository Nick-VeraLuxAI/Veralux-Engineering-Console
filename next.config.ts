import type { NextConfig } from "next";
import path from "path";

// The wip snapshot carries pre-existing type/lint errors in unrelated modules.
// Deployments can opt in to building anyway; default behaviour is unchanged.
const ignoreBuildErrors = process.env.ENGINEER_CONSOLE_BUILD_IGNORE_TYPE_ERRORS === "1";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: path.join(__dirname),
  typescript: { ignoreBuildErrors },
  eslint: { ignoreDuringBuilds: ignoreBuildErrors },
};

export default nextConfig;
