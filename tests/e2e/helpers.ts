import type { APIRequestContext, Page } from "@playwright/test";
import path from "path";

export const E2E_ADMIN_EMAIL = "e2e@local.test";
export const E2E_ADMIN_PASSWORD = "e2e-test-pass";

/** Panel headings on the run detail page (smoke wiring only). */
export const RUN_DETAIL_PANEL_HEADINGS = [
  "Run state",
  "Audit timeline",
  "Evidence bundle",
  "Decision history",
  "Replay verification",
  "Policy results",
  "Review stages",
  "PR creation",
  "Merge controls",
  "Deployment gates",
  "Deployment execution",
  "Deployment health checks",
  "Deployment health policy",
  "Release checklist",
  "Release sign-off",
  "Generate worker plan draft",
  "Worker plan",
] as const;

export async function createTaskAndRun(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ taskId: string; runId: string }> {
  const repoPath = path.resolve(process.cwd());

  const taskResponse = await request.post(`${baseURL}/api/engineer-console/tasks`, {
    data: {
      title: `E2E smoke task ${Date.now()}`,
      description: "Browser smoke fixture",
      targetRepoPath: repoPath,
      priority: "normal",
    },
  });

  if (!taskResponse.ok()) {
    const body = await taskResponse.text();
    throw new Error(`Failed to create task: ${taskResponse.status()} ${body}`);
  }

  const taskPayload = (await taskResponse.json()) as { task: { id: string } };
  const taskId = taskPayload.task.id;

  const runResponse = await request.post(
    `${baseURL}/api/engineer-console/tasks/${taskId}/runs`,
    { data: {} },
  );

  if (!runResponse.ok()) {
    const body = await runResponse.text();
    throw new Error(`Failed to create run: ${runResponse.status()} ${body}`);
  }

  const runPayload = (await runResponse.json()) as { run: { id: string } };
  return { taskId, runId: runPayload.run.id };
}

export async function expectRunDetailPanelsVisible(page: Page): Promise<void> {
  for (const heading of RUN_DETAIL_PANEL_HEADINGS) {
    await page.getByRole("heading", { name: heading, exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor({ state: "visible" });
  }
  await page.getByText(/Hard release gates/i).first().scrollIntoViewIfNeeded();
  await page.getByText(/Hard release gates/i).first().waitFor({ state: "visible" });
}
