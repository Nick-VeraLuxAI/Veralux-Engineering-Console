import { expect, type APIRequestContext, type Page } from "@playwright/test";
import path from "path";
import { CSRF_HEADER_NAME } from "../../src/lib/engineer-console/security/csrf";
import {
  ensureE2eDatabaseReady,
  releaseE2eDbWriter,
  seedApprovedGovernanceForRun,
  seedFullReleaseLifecycleFixture,
  seedHardGateBlockedFixture,
  seedPrOnlyFixture,
  seedReleaseLifecycleRecordsOnly,
} from "./db-fixtures";
import { E2E_LOCAL_DB_PATH } from "./env";

export {
  E2E_ADMIN_EMAIL,
  E2E_OPERATOR_EMAIL,
  E2E_TEST_PASSWORD,
  E2E_VIEWER_EMAIL,
} from "./env";

let configuredE2eDbPath = E2E_LOCAL_DB_PATH;

export function configureE2eDatabasePath(dbPath: string = E2E_LOCAL_DB_PATH): void {
  configuredE2eDbPath = dbPath;
  ensureE2eDatabaseReady(dbPath);
}

export function getConfiguredE2eDbPath(): string {
  return configuredE2eDbPath;
}

async function mutationHeaders(
  request: APIRequestContext,
  baseURL: string,
): Promise<Record<string, string>> {
  const meRes = await request.get(`${baseURL}/api/engineer-console/auth/me`);
  if (!meRes.ok()) return {};
  const me = (await meRes.json()) as { csrfToken?: string | null };
  return me.csrfToken ? { [CSRF_HEADER_NAME]: me.csrfToken } : {};
}

/** Poll run detail API until the server returns a readable payload (DB visible to app). */
/** Wait until task mutations succeed (dev server finished recompiling hot routes). */
export async function waitForTasksMutationReady(
  request: APIRequestContext,
  baseURL: string,
): Promise<void> {
  const repoPath = path.resolve(process.cwd());
  await expect
    .poll(
      async () => {
        const res = await request.post(`${baseURL}/api/engineer-console/tasks`, {
          data: {
            title: `E2E readiness ${Date.now()}`,
            description: "readiness probe",
            targetRepoPath: repoPath,
            priority: "normal",
          },
        });
        return res.ok();
      },
      { timeout: 120_000, intervals: [500, 1000, 2000, 3000] },
    )
    .toBe(true);
}

export async function waitForRunDetailApiReady(
  request: APIRequestContext,
  baseURL: string,
  runId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await request.get(`${baseURL}/api/engineer-console/runs/${runId}`);
        if (!res.ok()) return false;
        const payload = (await res.json()) as {
          run?: { id?: string };
          task?: { id?: string };
        };
        return Boolean(payload.run?.id && payload.task?.id);
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
}

export async function waitForRunSettled(
  request: APIRequestContext,
  baseURL: string,
  runId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await request.get(`${baseURL}/api/engineer-console/runs/${runId}`);
        if (!res.ok()) return false;
        const payload = (await res.json()) as { run: { status: string } };
        return ["completed", "failed", "waiting_for_approval", "stopped"].includes(
          payload.run.status,
        );
      },
      { timeout: 90_000 },
    )
    .toBe(true);
}

export async function createBasicTaskAndRun(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ taskId: string; runId: string }> {
  return createTaskAndRun(request, baseURL);
}

export async function createTaskAndRun(
  request: APIRequestContext,
  baseURL: string,
  options?: {
    title?: string;
    description?: string;
  },
): Promise<{ taskId: string; runId: string }> {
  const repoPath = path.resolve(process.cwd());
  const headers = await mutationHeaders(request, baseURL);

  let lastError = "unknown";
  for (let attempt = 0; attempt < 8; attempt++) {
    const taskResponse = await request.post(`${baseURL}/api/engineer-console/tasks`, {
      headers,
      data: {
        title: options?.title ?? `E2E task ${Date.now()}`,
        description: options?.description ?? "E2E fixture",
        targetRepoPath: repoPath,
        priority: "normal",
      },
    });

    if (!taskResponse.ok()) {
      const body = (await taskResponse.text()).slice(0, 500);
      lastError = `task ${taskResponse.status()} ${body}`;
      await new Promise((r) => setTimeout(r, 1000 * Math.min(attempt + 1, 6)));
      continue;
    }

    const taskPayload = (await taskResponse.json()) as { task: { id: string } };
    const taskId = taskPayload.task.id;

    const runResponse = await request.post(
      `${baseURL}/api/engineer-console/tasks/${taskId}/runs`,
      { headers, data: {} },
    );

    if (!runResponse.ok()) {
      lastError = `run ${runResponse.status()} ${await runResponse.text()}`;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }

    const runPayload = (await runResponse.json()) as { run: { id: string } };
    return { taskId, runId: runPayload.run.id };
  }

  throw new Error(`Failed to create task/run after retries: ${lastError}`);
}

export async function createTaskOnly(
  request: APIRequestContext,
  baseURL: string,
  options?: {
    title?: string;
    description?: string;
  },
): Promise<{ taskId: string }> {
  const repoPath = path.resolve(process.cwd());
  const headers = await mutationHeaders(request, baseURL);
  const response = await request.post(`${baseURL}/api/engineer-console/tasks`, {
    headers,
    data: {
      title: options?.title ?? `E2E task ${Date.now()}`,
      description: options?.description ?? "E2E fixture",
      targetRepoPath: repoPath,
      priority: "normal",
    },
  });

  if (!response.ok()) {
    throw new Error(`Failed to create task: ${response.status()} ${await response.text()}`);
  }

  const payload = (await response.json()) as { task: { id: string } };
  return { taskId: payload.task.id };
}

export async function createRunWithWorkerPlanDraft(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ taskId: string; runId: string }> {
  const ids = await createTaskAndRun(request, baseURL);
  const draftResponse = await request.post(
    `${baseURL}/api/engineer-console/runs/${ids.runId}/worker-plan-drafts`,
    { data: { allowedFiles: ["README.md"], maxOperations: 1 } },
  );
  if (!draftResponse.ok()) {
    const body = await draftResponse.text();
    throw new Error(`Failed to create worker plan draft: ${draftResponse.status()} ${body}`);
  }
  return ids;
}

async function withDbSeed<T>(fn: () => Promise<T>): Promise<T> {
  ensureE2eDatabaseReady(getConfiguredE2eDbPath());
  try {
    return await fn();
  } finally {
    releaseE2eDbWriter();
  }
}

export async function createRunWithGovernanceFixture(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ taskId: string; runId: string }> {
  const ids = await createTaskAndRun(request, baseURL);
  await withDbSeed(() => seedApprovedGovernanceForRun(ids.runId));
  return ids;
}

export async function createFullReleaseLifecycleRun(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ taskId: string; runId: string }> {
  const ids = await createTaskAndRun(request, baseURL);
  await withDbSeed(async () => {
    await seedApprovedGovernanceForRun(ids.runId);
    await seedReleaseLifecycleRecordsOnly(ids.runId, ids.taskId);
  });
  return ids;
}

export async function createReleaseRecordsOnlyRun(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ taskId: string; runId: string }> {
  const ids = await createTaskAndRun(request, baseURL);
  await withDbSeed(() => seedReleaseLifecycleRecordsOnly(ids.runId, ids.taskId));
  return ids;
}

export async function createHardGateBlockedRun(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ taskId: string; runId: string }> {
  const ids = await createTaskAndRun(request, baseURL);
  await withDbSeed(() => seedHardGateBlockedFixture(ids.runId, ids.taskId));
  return ids;
}

export async function createPrOnlyRun(
  request: APIRequestContext,
  baseURL: string,
): Promise<{ taskId: string; runId: string }> {
  const ids = await createTaskAndRun(request, baseURL);
  await withDbSeed(() => seedPrOnlyFixture(ids.runId, ids.taskId));
  return ids;
}

export const RELEASE_PANEL_HEADINGS = [
  "PR creation",
  "Merge controls",
  "Deployment gates",
  "Deployment execution",
  "Deployment health checks",
  "Deployment health policy",
  "Release checklist",
  "Release sign-off",
] as const;

export async function expectReleasePanelsVisible(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "PR", exact: true }).click();
  await page.getByRole("heading", { name: "PR creation", exact: true }).waitFor({ state: "visible" });

  await page.getByRole("tab", { name: "Release", exact: true }).click();

  for (const heading of RELEASE_PANEL_HEADINGS.filter((heading) => heading !== "PR creation")) {
    const locator = page.getByRole("heading", { name: heading, exact: true });
    await locator.scrollIntoViewIfNeeded();
    await locator.waitFor({ state: "visible" });
  }
  await page.getByText(/Hard release gates/i).first().scrollIntoViewIfNeeded();
  await page.getByText(/Hard release gates/i).first().waitFor({ state: "visible" });
}
