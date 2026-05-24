import { expect, test } from "@playwright/test";
import {
  createTaskAndRun,
  expectRunDetailPanelsVisible,
  gotoRunDetailResilient,
} from "./helpers";

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

  test("run detail panels render for API-created fixture", async ({ page, request, baseURL }) => {
    const { runId } = await createTaskAndRun(request, baseURL!);
    await gotoRunDetailResilient(page, runId);
    try {
      await expectRunDetailPanelsVisible(page);
    } catch {
      await gotoRunDetailResilient(page, runId);
      await expectRunDetailPanelsVisible(page);
    }
  });

});
