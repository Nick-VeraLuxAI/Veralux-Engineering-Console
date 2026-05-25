import Link from "next/link";
import React from "react";
import {
  buildStagingSmokeWorkflowSteps,
  type StagingTaskPreset,
} from "@/lib/engineer-console/setup/setup-ux";

export function StagingSmokeWorkflowHelper({
  smokeRepoExamplePath,
  stagingTaskPreset,
}: {
  smokeRepoExamplePath: string;
  stagingTaskPreset: StagingTaskPreset;
}) {
  const steps = buildStagingSmokeWorkflowSteps();

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Run staging smoke workflow</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Guidance only. This helper does not register repos, create tasks, start runs, or execute
          release actions automatically.
        </p>
      </div>

      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step.id} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="font-medium">
              {index + 1}. {step.title}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">{step.detail}</p>
            {step.href ? (
              <Link href={step.href} className="mt-2 inline-flex text-sm text-[var(--accent)] underline underline-offset-2">
                Open
              </Link>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">Example smoke repo path</p>
          <pre className="mt-2 overflow-auto rounded bg-[var(--card)] p-2 text-xs">{smokeRepoExamplePath}</pre>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
          <p className="text-sm font-medium">README smoke task preset</p>
          <pre className="mt-2 overflow-auto rounded bg-[var(--card)] p-2 text-xs">
{`Title: ${stagingTaskPreset.title}

Description: ${stagingTaskPreset.description}

Priority: ${stagingTaskPreset.priority}`}
          </pre>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--muted)]">
        <p className="font-medium text-white">Reference docs</p>
        <p className="mt-2">
          Record results in <code>docs/staging-dry-run-report.md</code> and follow{" "}
          <code>docs/staging-dry-run-checklist.md</code>. For setup context, use{" "}
          <code>docs/operator-runbook.md</code> and <code>docs/env-reference.md</code>.
        </p>
      </div>
    </section>
  );
}
