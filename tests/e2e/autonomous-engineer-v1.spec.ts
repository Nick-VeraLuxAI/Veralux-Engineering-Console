import { expect, test } from "@playwright/test";

test.describe("Autonomous Engineer V1 director flow", () => {
  test("create-task form defaults to autonomous and does not require worker-plan buttons", async ({
    page,
  }) => {
    await page.goto("/engineer?details=tasks");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("heading", { name: "New engineering objective" })).toBeVisible();
    await expect(page.getByLabel(/Start Autonomous Run/i)).toBeChecked();
    await expect(page.getByRole("button", { name: "Start Autonomous Run" })).toBeVisible();
    await expect(page.getByRole("button", { name: /generate worker plan/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /submit worker plan/i })).toHaveCount(0);
    await page.screenshot({
      path: "test-results/autonomous-engineer-v1-create-task.png",
      fullPage: true,
    });
  });

  test("live run page shows progress without generate/submit/QC babysitting", async ({ page }) => {
    const runId = process.env.AE_V1_PROGRESS_RUN_ID;
    test.skip(!runId, "AE_V1_PROGRESS_RUN_ID not set");
    await page.goto(`/engineer/runs/${runId}`);
    await expect(page.locator("#autonomous-engineer-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /generate worker plan/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /submit worker plan/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /run qc/i })).toHaveCount(0);
    await expect(page.getByTestId("ae-progress")).toBeVisible();
    await page.screenshot({
      path: "test-results/autonomous-engineer-v1-progress.png",
      fullPage: true,
    });
  });

  test("clarification pause is visible and resume keeps the same run", async ({ page }) => {
    const runId = process.env.AE_V1_CLARIFICATION_RUN_ID;
    test.skip(!runId, "AE_V1_CLARIFICATION_RUN_ID not set");
    test.setTimeout(180_000);
    await page.goto(`/engineer/runs/${runId}`);
    await expect(page.getByTestId("ae-clarification")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ae-clarification")).toContainText(/foo or bar/i);
    await page.getByTestId("ae-clarification").locator("textarea").fill("bar");
    const resume = page.getByRole("button", { name: "Resume" });
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/autonomous/clarification`) &&
          response.request().method() === "POST",
        { timeout: 170_000 },
      ),
      resume.click(),
    ]);
    await expect(page).toHaveURL(new RegExp(`/engineer/runs/${runId}`));
    await expect(page.getByTestId("ae-clarification")).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({
      path: "test-results/autonomous-engineer-v1-clarification.png",
      fullPage: true,
    });
  });

  test("delivery candidate package is visible to the director", async ({ page }) => {
    const runId = process.env.AE_V1_DELIVERY_RUN_ID;
    test.skip(!runId, "AE_V1_DELIVERY_RUN_ID not set");
    await page.goto(`/engineer/runs/${runId}`);
    const panel = page.getByTestId("ae-delivery-candidate");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText("Objective");
    await expect(panel).toContainText("Implementation summary");
    await expect(panel).toContainText("Iterations");
    await expect(panel).toContainText("QC baseline / post");
    await expect(panel).toContainText("New regressions");
    await expect(panel).toContainText("Pre-existing");
    await expect(panel).toContainText("Reviews");
    await expect(panel).toContainText("Risks");
    await expect(panel).toContainText("Evidence");
    await expect(panel).toContainText("Next governed action");
    await page.screenshot({
      path: "test-results/autonomous-engineer-v1-delivery-candidate.png",
      fullPage: true,
    });
  });
});
