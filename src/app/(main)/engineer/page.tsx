import Link from "next/link";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { listRegisteredRepos } from "@/lib/engineer-console/repo-intelligence/registered-repos/list-repos";
import {
  buildDashboardSetupSummary,
  getPublicSetupEnvironmentSummary,
} from "@/lib/engineer-console/setup/build-setup-readiness-summary";
import { listTasks } from "@/lib/engineer-console/task-manager/task-manager";
import {
  buildDashboardOperatorQueueData,
  buildSetupAttentionQueueItems,
} from "@/lib/engineer-console/run-ux/operator-queue";
import { resolveOperatorQueuePresetId } from "@/lib/engineer-console/run-ux/operator-queue-view";
import { buildEngineeringWorkflowMapData } from "@/lib/engineer-console/dashboard/workflow-map";
import { EngineeringConsoleCanvasHome } from "@/components/engineer-console/engineering-console-canvas-home";
import { EngineerTaskList } from "@/components/engineer-console/engineer-task-list";
import { MainlineRuntimeProofPanel } from "@/components/engineer-console/mainline-runtime-proof-panel";
import { OperatorQueuePanel } from "@/components/engineer-console/operator-queue-panel";
import { SetupReadinessPanel } from "@/components/engineer-console/setup-readiness-panel";
import { StagingSmokeWorkflowHelper } from "@/components/engineer-console/staging-smoke-workflow-helper";
import { buildMainlineTaskRunProof } from "@/lib/engineer-console/mainline-runtime/mainline-task-run-proof";

export const dynamic = "force-dynamic";

function resolveDetailsPanel(
  details: string | string[] | undefined,
  tab?: string | string[] | undefined,
): "setup" | "queue" | "tasks" | "staging" | "activity" | "docs" | null {
  const raw = Array.isArray(details) ? details[0] : details;
  if (
    raw === "setup" ||
    raw === "queue" ||
    raw === "tasks" ||
    raw === "staging" ||
    raw === "activity" ||
    raw === "docs"
  ) {
    return raw;
  }

  const legacyTab = Array.isArray(tab) ? tab[0] : tab;
  return legacyTab === "activity" || legacyTab === "docs" ? legacyTab : null;
}

function buildEnvironmentLabel() {
  const env = getPublicSetupEnvironmentSummary();
  if (env.trustedLocalDev) return "Trusted local";
  if (env.nodeEnv === "production") return "Production-like";
  if (env.nodeEnv === "test") return "Test environment";
  return "Development";
}

export default async function EngineerPage({
  searchParams,
}: {
  searchParams?: Promise<{ queue?: string | string[]; details?: string | string[]; tab?: string | string[] }>;
}) {
  ensureEngineerConsoleReady();
  const tasks = listTasks();
  const repos = listRegisteredRepos();
  const setup = buildDashboardSetupSummary();
  const queueData = await buildDashboardOperatorQueueData(tasks);
  const queueItems = [...queueData.items, ...buildSetupAttentionQueueItems(setup)];
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialPreset = resolveOperatorQueuePresetId(resolvedSearchParams.queue);
  const hasQueueQueryParam = resolvedSearchParams.queue !== undefined;
  const detailPanel = resolveDetailsPanel(resolvedSearchParams.details, resolvedSearchParams.tab);
  const mainlineProof = buildMainlineTaskRunProof();
  const workflowMapData = buildEngineeringWorkflowMapData({
    tasks,
    repos,
    queueItems,
    setup,
  });

  return (
    <>
      <div className="mb-4 rounded-3xl border border-white/10 bg-black/20 p-4">
        <Link href="/engineer/projects" className="text-sm font-medium text-white hover:underline">
          Open governed projects
        </Link>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Register project specifications, requirements, acceptance criteria, and Vera orchestration decisions.
        </p>
      </div>
      <MainlineRuntimeProofPanel proof={mainlineProof} />
      <EngineeringConsoleCanvasHome
        mapData={workflowMapData}
        detailPanel={detailPanel}
        environmentLabel={buildEnvironmentLabel()}
      >
      {detailPanel === "setup" ? (
        <div id="dashboard-details-setup" className="space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Setup details</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Setup and staging details</h2>
            </div>
          </div>
          <SetupReadinessPanel summary={setup.readiness} />
          {setup.showStagingHelper ? (
            <StagingSmokeWorkflowHelper
              smokeRepoExamplePath={setup.smokeRepoExamplePath}
              stagingTaskPreset={setup.stagingTaskPreset}
            />
          ) : null}
        </div>
      ) : null}

      {detailPanel === "staging" ? (
        <div id="dashboard-details-staging" className="space-y-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Staging checklist</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Run staging smoke workflow</h2>
          </div>
          {setup.showStagingHelper ? (
            <StagingSmokeWorkflowHelper
              smokeRepoExamplePath={setup.smokeRepoExamplePath}
              stagingTaskPreset={setup.stagingTaskPreset}
            />
          ) : (
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5 text-sm text-[var(--muted)]">
              <p className="font-medium text-white">No staging checklist is active right now.</p>
              <p className="mt-2">
                The staging helper appears only in trusted-local, development, or staging-like contexts
                where smoke guidance is relevant.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {detailPanel === "queue" ? (
        <div id="dashboard-details-queue" className="space-y-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Queue details</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Operator queue</h2>
          </div>
          <OperatorQueuePanel
            items={queueItems}
            registeredRepoCount={repos.length}
            taskCount={queueData.taskCount}
            taskCountWithoutRuns={queueData.taskCountWithoutRuns}
            initialPreset={initialPreset}
            hasQueueQueryParam={hasQueueQueryParam}
          />
        </div>
      ) : null}

      {detailPanel === "tasks" ? (
        <div id="dashboard-details-tasks" className="space-y-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Task details</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Tasks</h2>
          </div>
          <EngineerTaskList
            initialTasks={tasks}
            taskQueueItems={queueData.items}
            registeredRepoCount={repos.length}
            showStagingPreset={setup.showStagingHelper}
            stagingTaskPreset={setup.stagingTaskPreset}
          />
        </div>
      ) : null}

      {detailPanel === "activity" ? (
        <div id="dashboard-activity-panel" className="space-y-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Activity</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Recent workflow activity</h2>
          </div>
          {workflowMapData.activityItems.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-black/20 p-5 text-sm text-[var(--muted)]">
              No recent activity is available yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {workflowMapData.activityItems.map((item) => (
                <li key={item.id} className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    {item.label}
                  </p>
                  <p className="mt-2 text-sm text-white">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {detailPanel === "docs" ? (
        <div id="canvas-docs-panel" className="space-y-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Docs</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Operator references</h2>
          </div>
          <ul className="space-y-3">
            {[
              "docs/operator-runbook.md",
              "docs/operator-ux-guide.md",
              "docs/operator-ux-audit.md",
              "docs/final-hardening-notes.md",
            ].map((doc) => (
              <li key={doc} className="rounded-3xl border border-white/10 bg-black/20 p-4">
                <code className="text-sm text-white">{doc}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </EngineeringConsoleCanvasHome>
    </>
  );
}
