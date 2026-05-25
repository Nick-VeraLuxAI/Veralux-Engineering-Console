import { expect, test } from "@playwright/test";
import {
  E2E_ADMIN_EMAIL,
  E2E_OPERATOR_EMAIL,
  E2E_TEST_PASSWORD,
  E2E_VIEWER_EMAIL,
} from "./fixtures";
import { gotoRunDetailResilient, loginEngineerConsole } from "./helpers";
import { CSRF_HEADER_NAME } from "../../src/lib/engineer-console/security/csrf";

async function expectRole(
  page: import("@playwright/test").Page,
  role: string,
): Promise<void> {
  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const res = await fetch("/api/engineer-console/auth/me", {
          credentials: "same-origin",
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { operator?: { role: string } };
        return data.operator?.role ?? null;
      });
    })
    .toBe(role);
}

async function postJsonInBrowser(
  page: import("@playwright/test").Page,
  path: string,
  data: unknown,
): Promise<number> {
  return page.evaluate(
    async ({ path, data, csrfHeader }) => {
      const meRes = await fetch("/api/engineer-console/auth/me", {
        credentials: "same-origin",
      });
      const me = (await meRes.json()) as { csrfToken?: string | null };
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (me.csrfToken) headers[csrfHeader] = me.csrfToken;
      const res = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify(data),
      });
      return res.status;
    },
    { path, data, csrfHeader: CSRF_HEADER_NAME },
  );
}

test.describe("Engineering Console auth roles", () => {
  test("viewer cannot create tasks via API", async ({ page }) => {
    await loginEngineerConsole(page, E2E_VIEWER_EMAIL, E2E_TEST_PASSWORD);
    await expectRole(page, "viewer");

    const status = await postJsonInBrowser(page, "/api/engineer-console/tasks", {
      title: "Viewer blocked",
      description: "should fail",
      targetRepoPath: process.cwd(),
      priority: "normal",
    });
    expect(status).toBe(403);
  });

  test("operator cannot create merge requests (admin-only)", async ({ page }) => {
    await loginEngineerConsole(page, E2E_OPERATOR_EMAIL, E2E_TEST_PASSWORD);
    await expectRole(page, "operator");

    const taskStatus = await postJsonInBrowser(page, "/api/engineer-console/tasks", {
      title: "Operator task",
      description: "fixture",
      targetRepoPath: process.cwd(),
      priority: "normal",
    });
    expect(taskStatus).toBe(201);
    const taskId = await page.evaluate(async () => {
      const res = await fetch("/api/engineer-console/tasks", { credentials: "same-origin" });
      const data = (await res.json()) as { tasks: { id: string }[] };
      return data.tasks[0]?.id;
    });

    const runStatus = await postJsonInBrowser(
      page,
      `/api/engineer-console/tasks/${taskId}/runs`,
      {},
    );
    expect(runStatus).toBe(201);
    const runId = await page.evaluate(async (tid) => {
      const res = await fetch(`/api/engineer-console/tasks/${tid}/runs`, {
        credentials: "same-origin",
      });
      const data = (await res.json()) as { runs: { id: string }[] };
      return data.runs[0]?.id;
    }, taskId);

    const mergeStatus = await postJsonInBrowser(
      page,
      `/api/engineer-console/runs/${runId}/merge-requests`,
      { prRequestId: "00000000-0000-0000-0000-000000000000", mergeMethod: "squash" },
    );
    expect(mergeStatus).toBe(403);
  });

  test("admin can load run detail sign-off panel", async ({ page }) => {
    await loginEngineerConsole(page, E2E_ADMIN_EMAIL, E2E_TEST_PASSWORD);
    await expectRole(page, "admin");

    const taskStatus = await postJsonInBrowser(page, "/api/engineer-console/tasks", {
      title: "Admin task",
      description: "fixture",
      targetRepoPath: process.cwd(),
      priority: "normal",
    });
    expect(taskStatus).toBe(201);
    const taskId = await page.evaluate(async () => {
      const res = await fetch("/api/engineer-console/tasks", { credentials: "same-origin" });
      const data = (await res.json()) as { tasks: { id: string }[] };
      return data.tasks[0]?.id;
    });
    const runStatus = await postJsonInBrowser(
      page,
      `/api/engineer-console/tasks/${taskId}/runs`,
      {},
    );
    expect(runStatus).toBe(201);
    const runId = await page.evaluate(async (tid) => {
      const res = await fetch(`/api/engineer-console/tasks/${tid}/runs`, {
        credentials: "same-origin",
      });
      const data = (await res.json()) as { runs: { id: string }[] };
      return data.runs[0]?.id;
    }, taskId);

    await gotoRunDetailResilient(page, runId);
    await page.getByRole("tab", { name: "Release", exact: true }).click();

    const signOff = page.locator("#release-signoff");
    await signOff.scrollIntoViewIfNeeded();
    await expect(signOff.getByRole("button", { name: "Record sign-off" })).toBeVisible({
      timeout: 30_000,
    });
  });
});
