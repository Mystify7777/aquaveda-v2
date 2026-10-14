import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

const PROTECTED_PAGES = [
  ["/learn/new", "New knowledge draft"],
  ["/learn/mine", "My articles"],
] as const;

test.describe("authenticated route boundary", () => {
  test("anonymous users are gated on canonical protected URLs", async ({ page }) => {
    for (const [path, heading] of PROTECTED_PAGES) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByText("Sign in to continue")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toHaveCount(0);
    }
  });

  test("/protected/* and the route-group segment are not URLs", async ({ page }) => {
    for (const path of ["/protected/learn/new", "/(protected)/learn/new"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
    }
  });

  test("canonical auth pages render", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.getByText("Welcome back")).toBeVisible();
    await page.goto("/auth/register");
    await expect(page.getByText("Create your account")).toBeVisible();
  });

  test("register -> protected pages -> sign out -> login restores access", async ({ page }) => {
    const email = `e2e-${randomUUID()}@example.test`;
    const password = "e2e-Passw0rd!-long-enough";

    await page.goto("/auth/register");
    await page.getByLabel("Name").fill("E2E Browser User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel("Signed-in role").first()).toHaveText("USER");

    for (const [path, heading] of PROTECTED_PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }

    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.goto("/learn/new");
    await expect(page.getByText("Sign in to continue")).toBeVisible();

    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/learn/new");
    await expect(page.getByRole("heading", { level: 1, name: "New knowledge draft" })).toBeVisible();
  });
});
