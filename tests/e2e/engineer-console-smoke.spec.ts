import { expect, test } from "@playwright/test";
import {
  createTaskAndRun,
  waitForRunDetailApiReady,
} from "./fixtures";
import {
  expectRunDetailPanelsVisible,
  gotoRunDetailResilient,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("Engineering Console trusted local smoke", () => {
  test("dashboard loads without login in trusted local mode", async ({ page }) => {
    await page.goto("/engineer");
    await expect(page).toHaveURL(/\/engineer\/?$/);
    await expect(page.getByRole("heading", { name: "Engineering tasks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/engineer\/login/);
  });

  test("registered repos page loads", async ({ page }) => {
    await page.goto("/engineer/repos");
    await expect(page.getByRole("heading", { name: "Registered repositories" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Register repository" })).toBeVisible();
  });

  test("compatibility page loads", async ({ page }) => {
    await page.goto("/engineer/compatibility");
    await expect(page.getByRole("heading", { name: "Compatibility analysis" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Run compatibility analysis" })).toBeVisible();
  });

  test("task creation form renders from dashboard", async ({ page }) => {
    await page.goto("/engineer");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("heading", { name: "Create engineering task" })).toBeVisible();
  });

  test.describe("run detail", () => {
    test.describe.configure({ retries: 2 });

    test("API fixture is readable before navigation", async ({ request, baseURL }) => {
      const { runId } = await createTaskAndRun(request, baseURL!);
      await waitForRunDetailApiReady(request, baseURL!, runId);
      const res = await request.get(`${baseURL}/api/engineer-console/runs/${runId}`);
      expect(res.ok()).toBe(true);
      const payload = (await res.json()) as { run: { id: string }; task: { id: string } };
      expect(payload.run.id).toBe(runId);
      expect(payload.task.id).toBeTruthy();
    });

    test("panels render for API-created fixture", async ({ page, request, baseURL }) => {
      const { runId } = await createTaskAndRun(request, baseURL!);
      await gotoRunDetailResilient(page, runId, request, baseURL!);
      await expect(
        page.getByRole("heading", { name: "Run Command Center", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Lifecycle", exact: true })).toBeVisible();
      await expect(page.getByText("Next recommended action")).toBeVisible();
      await expectRunDetailPanelsVisible(page);
    });
  });

});
