import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { listRegisteredRepos } from "@/lib/engineer-console/repo-intelligence/registered-repos/list-repos";
import { buildDashboardSetupSummary } from "@/lib/engineer-console/setup/build-setup-readiness-summary";
import { listTasks } from "@/lib/engineer-console/task-manager/task-manager";
import {
  buildDashboardOperatorQueueData,
  buildSetupAttentionQueueItems,
} from "@/lib/engineer-console/run-ux/operator-queue";
import { EngineerTaskList } from "@/components/engineer-console/engineer-task-list";
import { OperatorQueuePanel } from "@/components/engineer-console/operator-queue-panel";
import { SetupReadinessPanel } from "@/components/engineer-console/setup-readiness-panel";
import { StagingSmokeWorkflowHelper } from "@/components/engineer-console/staging-smoke-workflow-helper";

export const dynamic = "force-dynamic";

export default async function EngineerPage() {
  ensureEngineerConsoleReady();
  const tasks = listTasks();
  const repos = listRegisteredRepos();
  const setup = buildDashboardSetupSummary();
  const queueData = await buildDashboardOperatorQueueData(tasks);
  const queueItems = [...queueData.items, ...buildSetupAttentionQueueItems(setup)];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Engineering tasks</h1>
          <p className="text-sm text-[var(--muted)]">
            Manage AI-assisted engineering workflows through the control plane.
          </p>
        </div>
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <SetupReadinessPanel summary={setup.readiness} />
        {setup.showStagingHelper ? (
          <StagingSmokeWorkflowHelper
            smokeRepoExamplePath={setup.smokeRepoExamplePath}
            stagingTaskPreset={setup.stagingTaskPreset}
          />
        ) : null}
      </div>
      <div className="mb-6">
        <OperatorQueuePanel
          items={queueItems}
          registeredRepoCount={repos.length}
          taskCount={queueData.taskCount}
          taskCountWithoutRuns={queueData.taskCountWithoutRuns}
        />
      </div>
      <EngineerTaskList
        initialTasks={tasks}
        taskQueueItems={queueData.items}
        registeredRepoCount={repos.length}
        showStagingPreset={setup.showStagingHelper}
        stagingTaskPreset={setup.stagingTaskPreset}
      />
      <p className="mt-6 text-xs text-[var(--muted)]">
        Workflow: task → branch → agent run → patch tracking → quality gates → approval
      </p>
    </div>
  );
}
