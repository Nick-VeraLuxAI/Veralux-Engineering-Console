import { expect, test } from "@playwright/test";
import { createTaskAndRun } from "./fixtures";
import { gotoRunDetailResilient } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("Run issue queue lifecycle smoke", () => {
  test("worker plan stage separates active blockers from future requirements", async ({
    page,
    request,
    baseURL,
  }) => {
    const { runId } = await createTaskAndRun(request, baseURL!, {
      title: "Issue queue lifecycle smoke",
      description: "Verify lifecycle-aware issue prioritization at worker plan stage.",
    });
    await gotoRunDetailResilient(page, runId, request, baseURL!);

    await expect(page.getByText(/Stage:\s*Worker Plan/i)).toBeVisible();
    await expect(page.getByText(/0 active blocker/i)).toBeVisible();
    await expect(page.getByText(/Review and execute the worker plan/i)).toBeVisible();

    await page.getByRole("button", { name: "Expand" }).click();
    await expect(page.getByText("Future requirements")).toBeVisible();
    await expect(page.getByText(/Release gate requirements pending later/i)).toBeVisible();
    await expect(page.getByText("Hard release gate blocked", { exact: true })).toHaveCount(0);
  });
});
