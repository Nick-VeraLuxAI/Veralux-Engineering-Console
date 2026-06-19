import Link from "next/link";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { listProjects } from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import { ProjectCreateForm } from "@/components/engineer-console/project-create-form";

export const dynamic = "force-dynamic";

export default function EngineerProjectsPage() {
  ensureEngineerConsoleReady();
  const projects = listProjects();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/engineer" className="text-sm text-[var(--muted)] hover:text-white">
          ← Engineering console
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Governed projects</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Projects hold the durable specification, requirements, acceptance criteria, and Vera
          orchestration decisions needed to move work forward without relying on chat memory.
        </p>
      </div>
      <ProjectCreateForm />
      <section className="rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-lg font-semibold">Project registry</h2>
        {projects.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No governed projects have been created yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {projects.map((project) => (
              <li key={project.id} className="py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <Link href={`/engineer/projects/${project.id}`} className="font-medium text-white hover:underline">
                      {project.name}
                    </Link>
                    <p className="mt-1 text-sm text-[var(--muted)]">{project.description || "No description."}</p>
                    <p className="mt-2 font-mono text-xs text-[var(--muted)]">
                      {project.targetRepoPath ?? project.registeredRepoId ?? "No repo linkage configured"}
                    </p>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="rounded border border-[var(--border)] px-2 py-1">{project.status}</span>
                    <span className="rounded border border-[var(--border)] px-2 py-1">
                      {project.orchestrationStatus}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
