import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { listTasks } from "@/lib/engineer-console/task-manager/task-manager";
import { EngineerTaskList } from "@/components/engineer-console/engineer-task-list";

export const dynamic = "force-dynamic";

export default function EngineerPage() {
  ensureEngineerConsoleReady();
  const tasks = listTasks();

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
      <EngineerTaskList initialTasks={tasks} />
      <p className="mt-6 text-xs text-[var(--muted)]">
        Workflow: task → branch → agent run → patch tracking → quality gates → approval
      </p>
    </div>
  );
}
