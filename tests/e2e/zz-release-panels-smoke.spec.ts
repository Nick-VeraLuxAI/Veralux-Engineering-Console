import { expect, test } from "@playwright/test";
import {
  createReleaseRecordsOnlyRun,
  expectReleasePanelsVisible,
  waitForTasksMutationReady,
} from "./fixtures";
import { gotoRunDetailResilient } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("Release lifecycle panels (fixture-driven)", () => {
  test("renders release panels with seeded PR/merge and empty deploy states", async ({
    page,
    request,
    baseURL,
  }) => {
    await waitForTasksMutationReady(request, baseURL!);
    const { runId } = await createReleaseRecordsOnlyRun(request, baseURL!);
    await expect
      .poll(async () => {
        const res = await request.get(
          `${baseURL}/api/engineer-console/runs/${runId}/merge-requests`,
        );
        return res.ok();
      })
      .toBe(true);

    await gotoRunDetailResilient(page, runId, request, baseURL!);
    await expectReleasePanelsVisible(page);

    await page.getByRole("tab", { name: "PR", exact: true }).click();

    const prSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "PR creation", exact: true }) });
    await expect(prSection.getByRole("heading", { name: "PR state", exact: true })).toBeVisible();
    await expect(prSection.getByRole("link", { name: /example.com\/pr\/e2e/i }).first()).toBeVisible();
    await expect(prSection.getByText("base main")).toBeVisible();
    await expect(prSection.getByRole("button", { name: "Existing PR recorded" })).toBeDisabled();

    await page.getByRole("tab", { name: "Release", exact: true }).click();

    const mergeSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Merge controls", exact: true }) });
    await expect(mergeSection.getByLabel(/PR request/i)).toContainText(/#42/i);

    const deployExec = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Deployment execution", exact: true }) });
    await expect(
      deployExec.getByText(/No approved deployment|Complete deployment gates/i),
    ).toBeVisible();
  });
});
