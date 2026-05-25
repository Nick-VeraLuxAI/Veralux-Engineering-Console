import { expect, test } from "@playwright/test";
import { E2E_GATES_DB_PATH } from "./env";
import { configureE2eDatabasePath, createHardGateBlockedRun } from "./fixtures";
import { gotoRunDetailResilient } from "./helpers";

test.beforeAll(async ({ request, baseURL }) => {
  configureE2eDatabasePath(E2E_GATES_DB_PATH);
  await expect
    .poll(async () => {
      const res = await request.get(`${baseURL}/engineer`);
      return res.ok();
    }, { timeout: 120_000 })
    .toBe(true);
});

test.describe("Hard release gates (enabled)", () => {
  test("release-gates and merge readiness stay blocked without executing merge", async ({
    page,
    request,
    baseURL,
  }) => {
    const { runId } = await createHardGateBlockedRun(request, baseURL!);

    await expect
      .poll(async () => {
        const res = await request.get(
          `${baseURL}/api/engineer-console/runs/${runId}/release-gates`,
        );
        if (!res.ok()) return false;
        const data = (await res.json()) as {
          config?: { hardGatesEnabled?: boolean };
          evaluations?: { merge?: { status?: string; blockers?: string[] } };
        };
        return (
          data.config?.hardGatesEnabled === true &&
          data.evaluations?.merge?.status === "blocked" &&
          (data.evaluations?.merge?.blockers?.length ?? 0) > 0
        );
      })
      .toBe(true);

    const readinessRes = await request.get(
      `${baseURL}/api/engineer-console/runs/${runId}/merge-readiness`,
    );
    expect(readinessRes.ok()).toBe(true);
    const readiness = (await readinessRes.json()) as {
      readiness?: { status?: string; blockers?: string[] };
    };
    expect(readiness.readiness?.status).toBe("blocked");
    expect(readiness.readiness?.blockers?.join(" ")).toMatch(/policy|governance/i);

    const checklistRes = await request.get(
      `${baseURL}/api/engineer-console/runs/${runId}/release-checklist`,
    );
    expect(checklistRes.ok()).toBe(true);
    const checklist = (await checklistRes.json()) as {
      latest?: { status?: string } | null;
      computed?: { status?: string };
    };
    const status = checklist.latest?.status ?? checklist.computed?.status;
    expect(["blocked", "needs_attention"]).toContain(status);

    await gotoRunDetailResilient(page, runId, request, baseURL!);
    const releaseGroup = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "PR & Release", exact: true }) })
      .first();
    const toggle = releaseGroup.getByRole("button", { name: /Show details|Hide details/i });
    if ((await toggle.innerText()).match(/show details/i)) {
      await toggle.click();
    }

    const mergeSection = page.locator(`#merge-controls`);
    await expect(
      mergeSection.getByRole("heading", { name: "Action checklist", exact: true }),
    ).toBeVisible();
    await expect(
      mergeSection
        .getByRole("link", { name: /Go to Policy results|Go to Replay verification|Go to Review stages/i })
        .first(),
    ).toBeVisible();
  });
});
