import type { Page } from "@playwright/test";
import {
  createTaskAndRun,
  E2E_ADMIN_EMAIL,
  E2E_TEST_PASSWORD as E2E_ADMIN_PASSWORD,
} from "./fixtures";

export { createTaskAndRun, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD };

/** Core panels present for a freshly API-created run (smoke wiring). */
export const CORE_RUN_DETAIL_PANEL_HEADINGS = [
  "Run state",
  "Audit timeline",
  "Evidence bundle",
  "Decision history",
  "Replay verification",
  "Policy results",
  "Review stages",
  "PR creation",
  "Merge controls",
  "Deployment gates",
  "Deployment execution",
  "Deployment health checks",
  "Deployment health policy",
  "Release checklist",
  "Release sign-off",
  "Generate worker plan draft",
  "Worker plan",
] as const;

/** Full run detail page including release lifecycle panels (fixture-backed runs). */
export const RUN_DETAIL_PANEL_HEADINGS = CORE_RUN_DETAIL_PANEL_HEADINGS;

export async function gotoRunDetailResilient(page: Page, runId: string): Promise<void> {
  const url = `/engineer/runs/${runId}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const bodyText = await page.locator("body").innerText();
    if (/Internal Server Error|Application error/i.test(bodyText)) {
      lastError = bodyText.slice(0, 200);
      await page.waitForTimeout(1500 * (attempt + 1));
      continue;
    }
    try {
      await page.getByRole("heading", { name: "Run state" }).waitFor({ state: "visible", timeout: 30_000 });
      const afterLoad = await page.locator("body").innerText();
      if (!/Internal Server Error|Application error/i.test(afterLoad)) {
        return;
      }
      lastError = afterLoad.slice(0, 200);
    } catch (e) {
      lastError = e;
    }
    lastError = bodyText.slice(0, 200);
    await page.waitForTimeout(1500 * (attempt + 1));
  }
  throw new Error(`Run detail did not load after retries: ${String(lastError)}`);
}

export async function expectRunDetailPanelsVisible(page: Page): Promise<void> {
  for (const heading of RUN_DETAIL_PANEL_HEADINGS) {
    await page.getByRole("heading", { name: heading, exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("heading", { name: heading, exact: true }).waitFor({ state: "visible" });
  }
  await page.getByText(/Hard release gates/i).first().scrollIntoViewIfNeeded();
  await page.getByText(/Hard release gates/i).first().waitFor({ state: "visible" });
}

export async function loginEngineerConsole(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/engineer/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/engineer\/?$/, { timeout: 15_000 });
}
