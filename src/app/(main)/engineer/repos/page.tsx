import Link from "next/link";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { getLatestCompatibilityAnalysisRun } from "@/lib/engineer-console/repo-intelligence/compatibility/compatibility-manager";
import { listRegisteredRepos } from "@/lib/engineer-console/repo-intelligence/registered-repos/list-repos";
import { toPublicRegisteredRepo } from "@/lib/engineer-console/repo-intelligence/registered-repos/register-repo";
import {
  getRepoRootAllowlist,
  isRepoRootAllowlistConfigured,
} from "@/lib/engineer-console/repo-intelligence/registered-repos/repo-path-policy";
import { buildSmokeRepoExamplePath } from "@/lib/engineer-console/setup/setup-ux";
import { RegisteredReposPanel } from "@/components/engineer-console/registered-repos-panel";

export const dynamic = "force-dynamic";

export default function EngineerReposPage() {
  ensureEngineerConsoleReady();
  const repos = listRegisteredRepos().map(toPublicRegisteredRepo);
  const allowlistConfigured = isRepoRootAllowlistConfigured();
  const repoRoots = getRepoRootAllowlist() ?? [];
  const compatibilityAvailable = getLatestCompatibilityAnalysisRun()?.status === "completed";

  return (
    <div>
      <Link href="/engineer" className="text-sm text-[var(--muted)] hover:text-white">
        ← Engineering tasks
      </Link>
      <h1 className="mt-4 mb-2 text-2xl font-semibold">Registered repositories</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Register local Git repositories for safer task targeting. Package scripts and test runners
        are detected for metadata only — nothing runs automatically during registration.
      </p>
      {!allowlistConfigured && (
        <p className="mb-4 rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          <strong>Development mode:</strong> <code>ENGINEER_CONSOLE_REPO_ROOTS</code> is not set.
          Any local path may be registered. Set a comma-separated allowlist in production.
        </p>
      )}
      <RegisteredReposPanel
        initialRepos={repos}
        allowedRoots={repoRoots}
        compatibilityAvailable={compatibilityAvailable}
        smokeRepoExamplePath={buildSmokeRepoExamplePath(repoRoots)}
      />
    </div>
  );
}
