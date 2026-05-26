import { expect, test } from "@playwright/test";
import { createRunWithGovernanceFixture } from "./fixtures";
import { gotoRunDetailResilient } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("Run intelligence smoke", () => {
  test("run detail shows the read-only run intelligence card", async ({
    page,
    request,
    baseURL,
  }) => {
    const { runId } = await createRunWithGovernanceFixture(request, baseURL!);
    await gotoRunDetailResilient(page, runId, request, baseURL!);

    const intelligenceCard = page.locator('[data-run-intelligence-card="true"]');
    await expect(intelligenceCard).toBeVisible();
    await expect(intelligenceCard.getByRole("heading", { name: "Run Intelligence", exact: true })).toBeVisible();
    await expect(intelligenceCard.getByText(/Risk:/i).first()).toBeVisible();
    await expect(intelligenceCard.getByText(/Danger points:/i).first()).toBeVisible();

    const details = intelligenceCard.locator("details");
    await expect(details).toBeVisible();
    await details.locator("summary").click();
    await expect(details).toContainText("Signals already on the run page/API");
  });
});
