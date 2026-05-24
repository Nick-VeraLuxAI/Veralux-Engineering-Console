import { expect, test } from "@playwright/test";
import { createReleaseRecordsOnlyRun, expectReleasePanelsVisible } from "./fixtures";
import { gotoRunDetailResilient } from "./helpers";

test.describe("Release lifecycle panels (fixture-driven)", () => {
  test("renders release panels with seeded PR/merge and empty deploy states", async ({
    page,
    request,
    baseURL,
  }) => {
    const { runId } = await createReleaseRecordsOnlyRun(request, baseURL!);
    await expect
      .poll(async () => {
        const res = await request.get(
          `${baseURL}/api/engineer-console/runs/${runId}/merge-requests`,
        );
        return res.ok();
      })
      .toBe(true);

    await gotoRunDetailResilient(page, runId);
    await expect(page.getByRole("heading", { name: "PR creation" })).toBeVisible({
      timeout: 30_000,
    });
    await expectReleasePanelsVisible(page);

    const prSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "PR creation", exact: true }) });
    await expect(prSection.getByText(/example.com\/pr\/e2e/i)).toBeVisible();

    const mergeSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Merge controls", exact: true }) });
    await expect(mergeSection.getByText(/#42|merged/i).first()).toBeVisible();

    const deployExec = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Deployment execution", exact: true }) });
    await expect(
      deployExec.getByText(/No approved deployment|Complete deployment gates/i),
    ).toBeVisible();
    await expect(prSection.getByRole("button", { name: "Create draft PR" })).toBeDisabled();
  });
});
