import type { Page } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import {
  createTaskAndRun,
  E2E_ADMIN_EMAIL,
  E2E_TEST_PASSWORD as E2E_ADMIN_PASSWORD,
  waitForRunDetailApiReady,
} from "./fixtures";

export {
  createTaskAndRun,
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  waitForRunDetailApiReady,
};

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

export const RUN_DETAIL_GROUP_HEADINGS = [
  "Overview",
  "Work Plan",
  "Review",
  "PR",
  "Release",
  "Audit",
] as const;

/** Full run detail page including release lifecycle panels (fixture-backed runs). */
export const RUN_DETAIL_PANEL_HEADINGS = CORE_RUN_DETAIL_PANEL_HEADINGS;

export async function gotoRunDetailResilient(
  page: Page,
  runId: string,
  request?: APIRequestContext,
  baseURL?: string,
): Promise<void> {
  if (request && baseURL) {
    await waitForRunDetailApiReady(request, baseURL, runId);
  }

  const url = `/engineer/runs/${runId}`;
  const maxAttempts = 6;
  let lastError = "unknown";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await page.waitForTimeout(2000 * (attempt + 1));
      continue;
    }

    const bodyText = await page.locator("body").innerText();
    if (/Internal Server Error|Application error/i.test(bodyText)) {
      lastError = `SSR error page: ${bodyText.slice(0, 300)}`;
      await page.waitForTimeout(2000 * (attempt + 1));
      continue;
    }

    try {
      await page
        .getByRole("heading", { name: "Run state", exact: true })
        .waitFor({ state: "visible", timeout: 45_000 });
      await page.locator('[data-run-workspace-ready="true"]').waitFor({
        state: "visible",
        timeout: 45_000,
      });
      const afterLoad = await page.locator("body").innerText();
      if (!/Internal Server Error|Application error/i.test(afterLoad)) {
        return;
      }
      lastError = `SSR error after hydration: ${afterLoad.slice(0, 300)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await page.waitForTimeout(2000 * (attempt + 1));
  }

  throw new Error(
    `Run detail did not load after ${maxAttempts} attempts (runId=${runId}): ${lastError}`,
  );
}

export async function expectRunDetailPanelsVisible(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Run workspace", exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });

  for (const heading of RUN_DETAIL_GROUP_HEADINGS) {
    await page.getByRole("tab", { name: heading, exact: true }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }

  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("heading", { name: "Run state", exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.getByRole("heading", { name: /Current action:/i }).waitFor({
    state: "visible",
    timeout: 30_000,
  });

  await page.getByRole("tab", { name: "Work Plan", exact: true }).click();
  await page.getByRole("heading", { name: "Worker plan", exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });

  await page.getByRole("tab", { name: "Review", exact: true }).click();
  for (const heading of ["Evidence bundle", "Decision history", "Replay verification", "Policy results", "Review stages"] as const) {
    await page.getByRole("heading", { name: heading, exact: true }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }

  await page.getByRole("tab", { name: "PR", exact: true }).click();
  await page.getByRole("heading", { name: "PR creation", exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });

  await page.getByRole("tab", { name: "Release", exact: true }).click();
  for (const heading of [
    "Merge controls",
    "Deployment gates",
    "Deployment execution",
    "Deployment health checks",
    "Deployment health policy",
    "Release checklist",
    "Release sign-off",
  ] as const) {
    await page.getByRole("heading", { name: heading, exact: true }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }
  await page.getByText(/Hard release gates/i).first().waitFor({ state: "visible" });

  await page.getByRole("tab", { name: "Audit", exact: true }).click();
  await page.getByRole("heading", { name: "Audit timeline", exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
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
