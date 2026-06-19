import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import {
  listOrchestrationDecisions,
  loadProjectState,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import {
  calculateRequirementReadiness,
  evaluateProjectCompletion,
  selectNextRequirement,
} from "@/lib/engineer-console/project-orchestration/project-orchestrator";
import { getExecutionStatus } from "@/lib/engineer-console/project-orchestration/requirement-execution-controller";
import { ProjectOrchestrationControls } from "@/components/engineer-console/project-orchestration-controls";
import { ProjectSetupPanel } from "@/components/engineer-console/project-setup-panel";
import { listWorkspacesForProject } from "@/lib/engineer-console/project-orchestration/execution-workspace-manager";

export const dynamic = "force-dynamic";

export default async function EngineerProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  ensureEngineerConsoleReady();
  const { id } = await params;
  let state;
  try {
    state = loadProjectState(id);
  } catch {
    notFound();
  }
  const readiness = calculateRequirementReadiness(id);
  const nextRequirement = selectNextRequirement(id);
  const completion = evaluateProjectCompletion(id);
  const decisions = listOrchestrationDecisions(id).slice(0, 12);
  const execution = getExecutionStatus(id);
  const workspaces = listWorkspacesForProject(id).slice(0, 8);
  const project = state.project;
  const currentRequirement =
    state.requirements.find((requirement) => requirement.id === project.currentRequirementId) ?? null;
  const completedCount = state.requirements.filter((requirement) => requirement.status === "completed").length;
  const blockedRequirements = readiness.filter((entry) =>
    entry.blockers.some((blocker) => blocker.toLowerCase().includes("blocked")),
  );
  const verificationRequirements = state.requirements.filter(
    (requirement) => requirement.status === "verification",
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/engineer/projects" className="text-sm text-[var(--muted)] hover:text-white">
          ← Governed projects
        </Link>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
              {project.description || "No objective recorded."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded border border-[var(--border)] px-2 py-1">{project.status}</span>
            <span className="rounded border border-[var(--border)] px-2 py-1">
              {project.orchestrationStatus}
            </span>
          </div>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Specification" value={state.activeSpecification?.version ? `v${state.activeSpecification.version}` : "missing"} />
        <SummaryCard label="Requirements" value={`${completedCount}/${state.requirements.length} completed`} />
        <SummaryCard label="Next eligible" value={nextRequirement?.stableKey ?? "none"} />
        <SummaryCard label="Evidence links" value={String(state.evidenceLinks.length)} />
      </section>

      <ProjectOrchestrationControls
        project={project}
        currentRequirement={currentRequirement}
        latestDecision={state.latestDecision}
        activeAttempt={execution.activeAttempt}
      />

      <ProjectSetupPanel project={project} />

      <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-semibold">Execution loop</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <SummaryCard label="Active attempt" value={execution.activeAttempt ? `#${execution.activeAttempt.attemptNumber}` : "none"} />
          <SummaryCard label="Latest run" value={execution.latestRun?.status ?? "none"} />
          <SummaryCard label="Retry count" value={String(execution.attempts.length)} />
          <SummaryCard label="Latest failure" value={execution.failures.at(-1)?.category ?? "none"} />
        </div>
        {execution.attempts.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {execution.attempts.slice(0, 8).map((attempt) => (
              <li key={attempt.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">
                      Attempt {attempt.attemptNumber}: {attempt.status}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {attempt.strategy} · {attempt.modelProvider}/{attempt.modelName}
                    </p>
                    {attempt.failureFingerprint ? (
                      <p className="mt-2 font-mono text-xs text-amber-200">
                        {attempt.failureCategory}: {attempt.failureFingerprint.slice(0, 16)}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    <p>Run: {attempt.runId ?? "not dispatched"}</p>
                    <p>Evidence: {attempt.evidenceBundleId ?? "none"}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">No execution attempts have been recorded.</p>
        )}
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-semibold">Isolated workspaces</h2>
        {workspaces.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {workspaces.map((workspace) => (
              <li key={workspace.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {workspace.workspaceType}: {workspace.status}
                    </p>
                    <p className="mt-1 font-mono text-xs text-[var(--muted)]">{workspace.branchName}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Base {workspace.baseBranch} @ {workspace.baseCommit.slice(0, 12)}
                    </p>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    <p>Candidate: {workspace.candidateCommit?.slice(0, 12) ?? "none"}</p>
                    <p>Patch: {workspace.patchHash?.slice(0, 12) ?? "none"}</p>
                    <p>Cleanup: {workspace.cleanedAt ? "cleaned" : workspace.cleanupRequestedAt ? "pending" : "retained"}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No isolated workspace has been provisioned for this project yet.
          </p>
        )}
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-semibold">Specification and completion state</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Active specification</p>
            <p className="mt-2 text-sm text-white">
              {state.activeSpecification
                ? `${state.activeSpecification.title} (v${state.activeSpecification.version})`
                : "No specification attached."}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Awaiting verification</p>
            <p className="mt-2 text-sm text-white">{verificationRequirements.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Completion blockers</p>
            <p className="mt-2 text-sm text-white">
              {completion.complete ? "None" : completion.blockers.slice(0, 2).join("; ")}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-semibold">Requirements</h2>
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {readiness.map((entry) => {
            const criteria = state.acceptanceCriteria.filter(
              (criterion) => criterion.requirementId === entry.requirement.id,
            );
            const links = state.taskLinks.filter((link) => link.requirementId === entry.requirement.id);
            return (
              <li key={entry.requirement.id} className="py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-medium text-white">
                      {entry.requirement.stableKey}: {entry.requirement.title}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{entry.requirement.description}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      {criteria.length} criteria, {links.length} task link(s)
                    </p>
                    {!entry.eligible && entry.blockers.length > 0 ? (
                      <p className="mt-2 text-xs text-amber-200">{entry.blockers[0]}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded border border-[var(--border)] px-2 py-1">
                      {entry.requirement.status}
                    </span>
                    <span className="rounded border border-[var(--border)] px-2 py-1">
                      {entry.eligible ? "eligible" : "not eligible"}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {blockedRequirements.length > 0 ? (
          <p className="mt-4 text-sm text-amber-200">
            {blockedRequirements.length} requirement(s) currently have blocking conditions.
          </p>
        ) : null}
      </section>

      <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-semibold">Decision history</h2>
        {decisions.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No Vera orchestration decisions recorded yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {decisions.map((decision) => (
              <li key={decision.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-medium text-white">{decision.decisionType}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{decision.reason}</p>
                <p className="mt-2 font-mono text-xs text-[var(--muted)]">{decision.createdAt}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-sm font-medium text-white">{value}</p>
    </div>
  );
}
