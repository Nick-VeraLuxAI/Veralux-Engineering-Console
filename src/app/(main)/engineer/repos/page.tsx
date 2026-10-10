import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { getLatestCompatibilityAnalysisRun } from "@/lib/engineer-console/repo-intelligence/compatibility/compatibility-manager";
import { listRegisteredRepos } from "@/lib/engineer-console/repo-intelligence/registered-repos/list-repos";
import { toPublicRegisteredRepo } from "@/lib/engineer-console/repo-intelligence/registered-repos/register-repo";
import {
  getEffectiveRegistrationRoots,
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
  const repoRoots = getEffectiveRegistrationRoots() ?? getRepoRootAllowlist() ?? [];
  const compatibilityAvailable = getLatestCompatibilityAnalysisRun()?.status === "completed";

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Repositories</h1>
      {!allowlistConfigured && (
        <p className="mb-4 text-sm text-white/60">
          Approved roots are open in this environment. Production should restrict them.
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
