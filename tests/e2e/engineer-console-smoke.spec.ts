import { expect, test } from "@playwright/test";
import {
  createTaskOnly,
  createRunWithGovernanceFixture,
  createTaskAndRun,
  waitForRunDetailApiReady,
} from "./fixtures";
import {
  expectRunDetailPanelsVisible,
  gotoRunDetailResilient,
  RUN_DETAIL_GROUP_HEADINGS,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("Engineering Console trusted local smoke", () => {
  test("dashboard loads without login in trusted local mode", async ({ page }) => {
    await page.goto("/engineer");
    await expect(page).toHaveURL(/\/engineer\/?$/);
    await expect(page.getByRole("heading", { name: "Engineering tasks" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Setup readiness" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operator Queue" })).toBeVisible();
    await expect(page.getByText("What is setup readiness?")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run staging smoke workflow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/engineer\/login/);
  });

  test("dashboard operator queue filters and open run link work", async ({
    page,
    request,
    baseURL,
  }) => {
    const taskOnlyTitle = `E2E queue task ${Date.now()}`;
    await createTaskOnly(request, baseURL!, {
      title: taskOnlyTitle,
      description: "Operator queue task-only fixture",
    });
    const { runId } = await createTaskAndRun(request, baseURL!, {
      title: `E2E queue run ${Date.now()}`,
      description: "Operator queue run fixture",
    });
    await waitForRunDetailApiReady(request, baseURL!, runId);

    await page.goto("/engineer");
    const queue = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Operator Queue", exact: true }),
    });
    await expect(queue).toBeVisible();

    const needsActionTab = queue.getByRole("tab", { name: /Needs action/i });
    await needsActionTab.click();
    const queueItem = queue.locator("li").filter({ hasText: taskOnlyTitle }).first();
    await expect(queueItem).toBeVisible();

    await queue.getByRole("tab", { name: /All/i }).click();
    await queue.getByRole("link", { name: "Open run", exact: true }).first().click();
    await expect(page).toHaveURL(/\/engineer\/runs\/[^/]+$/);
  });

  test("registered repos page loads", async ({ page }) => {
    await page.goto("/engineer/repos");
    await expect(page.getByRole("heading", { name: "Registered repositories" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Register repository" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Approved repo roots" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Repo setup order" })).toBeVisible();
  });

  test("compatibility page loads", async ({ page }) => {
    await page.goto("/engineer/compatibility");
    await expect(page.getByRole("heading", { name: "Compatibility analysis" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Run compatibility analysis" })).toBeVisible();
    await expect(
      page.getByText("What is missing: no compatibility analysis results are recorded yet."),
    ).toBeVisible();
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

    test("panels render for governance-ready fixture", async ({ page, request, baseURL }) => {
      const { runId } = await createRunWithGovernanceFixture(request, baseURL!);
      await gotoRunDetailResilient(page, runId, request, baseURL!);
      await expect(
        page.getByRole("heading", { name: "Run Command Center", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: /Current action:/i })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Approval actions", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Lifecycle", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Quick navigation", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Expert summary", exact: true })).toBeVisible();
      await expect(page.getByText("Next recommended action")).toBeVisible();
      for (const heading of RUN_DETAIL_GROUP_HEADINGS) {
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      }

      const quickNav = page.getByRole("navigation", { name: "Run quick navigation" });
      await quickNav.getByRole("link", { name: "PR", exact: true }).click();
      await expect(page.locator("#pr-release").getByRole("button", { name: /Hide details/i })).toBeVisible();
      await expect(page.getByRole("heading", { name: "PR creation", exact: true })).toBeVisible();

      await quickNav.getByRole("link", { name: "Audit", exact: true }).click();
      await expect(
        page.locator("#technical-audit").getByRole("button", { name: /Hide details/i }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Audit timeline", exact: true })).toBeVisible();

      await expectRunDetailPanelsVisible(page);
      await expect(page.getByText("What is an evidence bundle?")).toBeVisible();
    });

    test("guided worker-plan builder supports README smoke helper", async ({
      page,
      request,
      baseURL,
    }) => {
      const { runId } = await createTaskAndRun(request, baseURL!, {
        title: "Create README smoke verification",
        description: "Create README.md for staging smoke verification.",
      });

      await gotoRunDetailResilient(page, runId, request, baseURL!);
      await expect(page.getByRole("heading", { name: "Guided worker-plan builder" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create README smoke plan" })).toBeVisible();

      await page.getByRole("button", { name: "Create README smoke plan" }).click();

      await expect(
        page.locator("pre").filter({ hasText: `"runId": "${runId}"` }).first(),
      ).toBeVisible();
      await expect(
        page.locator("pre").filter({ hasText: '"path": "README.md"' }).first(),
      ).toBeVisible();
      await expect(page.getByText("This plan will create file: README.md.")).toBeVisible();
    });
  });

});
