import { expect, test } from "@playwright/test";

const success = (data: unknown, message: string) => ({ success: true, data, message });

test("forgot password → reset → sign in", async ({ page }) => {
  const resetToken = "browser-smoke-reset-token";
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(success({ user: null }, "OK")),
  }));
  await page.route("**/api/v1/auth/refresh", (route) => route.fulfill({
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ success: false, data: null, message: "Refresh failed", code: "REFRESH_FAILED" }),
  }));
  await page.route("**/api/v1/auth/password-reset/request", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: "person@example.test" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(success(null, "If an account exists for that email, a reset link will be sent.")) });
  });
  await page.route("**/api/v1/auth/password-reset/confirm", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: resetToken, password: "new-password-value" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(success(null, "Password updated. Sign in with your new password.")) });
  });
  await page.route("**/api/v1/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ email: "person@example.test", password: "new-password-value" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(success({ user: { id: "smoke-user", role: "USER" } }, "Logged in")) });
  });

  await page.goto("/auth/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/auth\/forgot-password$/);
  await page.getByLabel("Email").fill("person@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");

  // The reset URL represents opening the link delivered by email.
  await page.goto(`/auth/reset-password?token=${resetToken}`);
  await page.getByLabel("New password", { exact: true }).fill("new-password-value");
  await page.getByLabel("Confirm new password").fill("new-password-value");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText(/Your password has been updated/)).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/login\?passwordReset=success$/);

  await page.getByLabel("Email").fill("person@example.test");
  await page.getByLabel("Password", { exact: true }).fill("new-password-value");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
});
