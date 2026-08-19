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
});
