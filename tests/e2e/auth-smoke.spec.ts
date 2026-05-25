import { expect, test } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./helpers";

test.describe("Engineering Console auth smoke", () => {
  test("redirects protected route to login without session", async ({ page }) => {
    await page.goto("/engineer");
    await expect(page).toHaveURL(/\/engineer\/login/);
    await expect(page.getByRole("heading", { name: "VeraLux Engineering Console" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("invalid login shows error and stays on login page", async ({ page }) => {
    await page.goto("/engineer/login");
    await page.getByLabel("Email").fill("nobody@local.test");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/invalid|failed|credentials/i)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/engineer\/login/);
  });

  test("bootstrap admin can sign in and reach dashboard", async ({ page }) => {
    await page.goto("/engineer/login");
    await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
    await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/engineer\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Engineering tasks" })).toBeVisible();
  });
});
