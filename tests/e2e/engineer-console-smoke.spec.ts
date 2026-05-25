import { expect, test } from "@playwright/test";
import {
  createTaskOnly,
  createRunWithGovernanceFixture,
  createTaskAndRun,
  waitForRunDetailApiReady,
} from "./fixtures";
import {
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

  test("dashboard operator queue presets and open run link work", async ({
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

    await expect(queue.getByRole("tab", { name: /My next actions/i })).toBeVisible();
    await expect(queue.getByRole("tab", { name: /Blocked \/ failed/i })).toBeVisible();
    await expect(queue.getByRole("tab", { name: /Approval queue/i })).toBeVisible();
    await expect(queue.getByRole("tab", { name: /Stale runs/i })).toBeVisible();

    const nextActionsTab = queue.getByRole("tab", { name: /My next actions/i });
    await nextActionsTab.click();
    const queueItem = queue.locator("li").filter({ hasText: taskOnlyTitle }).first();
    await expect(queueItem).toBeVisible();

    const blockedTab = queue.getByRole("tab", { name: /Blocked \/ failed/i });
    await blockedTab.click();
    await expect(blockedTab).toHaveAttribute("aria-selected", "true");
    await expect(queue.locator("li").filter({ hasText: taskOnlyTitle }).first()).toHaveCount(0);

    const staleTab = queue.getByRole("tab", { name: /Stale runs/i });
    await staleTab.click();
    await expect(staleTab).toHaveAttribute("aria-selected", "true");
    await expect(queue.locator("li").filter({ hasText: taskOnlyTitle }).first()).toHaveCount(0);

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

    test("workspace tabs and issue center render for governance-ready fixture", async ({
      page,
      request,
      baseURL,
    }) => {
      const { runId } = await createRunWithGovernanceFixture(request, baseURL!);
      await gotoRunDetailResilient(page, runId, request, baseURL!);
      await expect(
        page.getByRole("heading", { name: "Run workspace", exact: true }),
      ).toBeVisible();
      for (const heading of RUN_DETAIL_GROUP_HEADINGS) {
        await expect(page.getByRole("tab", { name: heading, exact: true })).toBeVisible();
      }
      const issueCenter = page.locator("aside").filter({
        has: page.getByText("Issue Center", { exact: true }),
      });
      await expect(issueCenter).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Run Command Center", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: /Current action:/i })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Lifecycle", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Quick navigation", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Expert summary", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /Open issue:/i })).toBeVisible();
    });

    test("PR and audit workspace views are reachable from the run workspace", async ({
      page,
      request,
      baseURL,
    }) => {
      const { runId } = await createTaskAndRun(request, baseURL!, {
        title: `Deep link workspace test ${Date.now()}`,
        description: "Verify PR and audit deep links open the correct workspace views.",
      });
      await gotoRunDetailResilient(page, runId, request, baseURL!);

      await expect(page.locator('a[href="#pr-creation"]').first()).toBeVisible();
      await expect(page.locator('a[href="#audit-timeline"]').first()).toBeVisible();

      await page.getByRole("tab", { name: "PR", exact: true }).click();
      await expect(page.getByRole("tab", { name: "PR", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
        { timeout: 15_000 },
      );
      await expect(page.getByRole("heading", { name: "PR creation", exact: true })).toBeVisible();

      await expect(page.getByRole("tab", { name: "Audit", exact: true })).toHaveAttribute(
        "aria-selected",
        "false",
      );
      await page.getByRole("tab", { name: "Audit", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Audit timeline", exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Audit", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
        { timeout: 15_000 },
      );
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
      await page.getByRole("tab", { name: "Work Plan", exact: true }).click();
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
