import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { API_ORIGIN } from "./env";
import fixtures from "./fixtures.json";

/**
 * #105: USER -> (ADMIN approves) -> EXPERT -> Knowledge moderation, in a real
 * browser against the real backend. ADMIN != EXPERT is asserted both ways.
 * Two isolated browser contexts = two independent cookie jars.
 */
// One-shot by design: the flow consumes seeded state (pending article, application),
// so a CI retry would fail for the wrong reason. globalSetup reseeds per run.
test.describe.configure({ retries: 0 });

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("USER applies -> ADMIN approves -> EXPERT moderates; role boundaries hold", async ({ browser }) => {
  const name = `E2E Applicant ${randomUUID().slice(0, 8)}`;
  const email = `e2e-${randomUUID()}@example.test`;
  const password = "e2e-Passw0rd!-long-enough";
  const experience = `Ten years of borewell recharge monitoring across three districts (${name}).`;

  const userCtx = await browser.newContext();
  const adminCtx = await browser.newContext();
  const user = await userCtx.newPage();
  const admin = await adminCtx.newPage();
  const role = (p: Page) => p.getByLabel("Signed-in role").first();

  try {
    await test.step("USER registers and submits an Expert application", async () => {
      await user.goto("/auth/register");
      await user.getByLabel("Name").fill(name);
      await user.getByLabel("Email").fill(email);
      await user.getByLabel("Password").fill(password);
      await user.getByRole("button", { name: "Create account" }).click();
      await expect(role(user)).toHaveText("USER");

      await user.goto("/learn/expert-application");
      // Details are collected, not a bare click: the form needs an area, experience and the acknowledgement.
      await user.getByRole("button", { name: "Submit application" }).click();
      await expect(user.getByText("Please fix the 3 highlighted fields and submit again.")).toBeVisible();
      await user.getByRole("checkbox", { name: /Groundwater and wells/ }).check();
      await user.getByLabel("What have you worked on, where, and for how long?").fill(experience);
      await user.getByRole("checkbox", { name: /I confirm that the information in this application is accurate/ }).check();
      await user.getByRole("button", { name: "Submit application" }).click();
      await expect(user.getByText(/Your application is awaiting review by an administrator/)).toBeVisible();
      await expect(user.getByText("What you submitted")).toBeVisible();
      await expect(user.getByRole("link", { name: /Become an Expert, application pending review/ }).first()).toBeVisible();
      await user.reload();
      await expect(user.getByText(/Your application is awaiting review by an administrator/)).toBeVisible();
      await expect(user.getByText(experience)).toBeVisible();
    });

    await test.step("USER cannot read the ADMIN queue but can read own status", async () => {
      // GET / is the admin pending list; GET /me is the applicant's own status.
      expect((await userCtx.request.get(`${API_ORIGIN}/api/v1/expert-application`)).status()).toBe(403);
      const own = await userCtx.request.get(`${API_ORIGIN}/api/v1/expert-application/me`);
      expect(own.status()).toBe(200);
      expect((await own.json()).data.status).toBe("pending");
    });

    await test.step("ADMIN sees the application and approves it", async () => {
      await signIn(admin, fixtures.adminEmail, fixtures.adminPassword);
      await expect(role(admin)).toHaveText("ADMIN");
      await admin.goto("/admin/expert-applications");
      await expect(admin.getByRole("heading", { level: 1, name: "Expert applications" })).toBeVisible();

      // Master-detail: pick the applicant, the reviewer sees what was submitted (not just a name and a date).
      await expect(admin.getByRole("link", { name: /Expert applications, \d+ pending application/ }).first()).toBeVisible();
      const queue = admin.getByRole("navigation", { name: "Pending applications" });
      await queue.getByRole("button", { name: new RegExp(name) }).click();
      await expect(admin.getByRole("heading", { level: 2, name })).toBeVisible();
      await expect(admin.getByText("Groundwater and wells")).toBeVisible();
      await expect(admin.getByText(experience)).toBeVisible();

      await admin.getByRole("button", { name: "Approve", exact: true }).click();
      await admin
        .getByRole("group", { name: `Confirm approval for ${name}` })
        .getByRole("button", { name: "Confirm approval" })
        .click();
      await expect(admin.getByText(`Approved ${name}. They now have Expert access.`)).toBeVisible();
    });

    await test.step("approval is persisted server-side", async () => {
      const own = await userCtx.request.get(`${API_ORIGIN}/api/v1/expert-application/me`);
      expect(own.status()).toBe(200);
      expect((await own.json()).data.status).toBe("approved");
      const pending = await adminCtx.request.get(`${API_ORIGIN}/api/v1/expert-application`);
      expect(pending.status()).toBe(200);
      const { items } = (await pending.json()).data as { items: { name: string }[] };
      expect(items.some((i) => i.name === name)).toBe(false);
    });

    await test.step("ADMIN does not acquire EXPERT-only moderation authority", async () => {
      const res = await adminCtx.request.get(`${API_ORIGIN}/api/v1/knowledge/review-queue`);
      expect(res.status()).toBe(403);
      await admin.goto("/learn/review");
      await expect(admin.getByText("Your account is not permitted to view the review queue.")).toBeVisible();
      await expect(admin.getByText(fixtures.pendingKnowledgeTitle)).toHaveCount(0);
    });

    await test.step("applicant's session reflects EXPERT", async () => {
      // Role is read fresh from the DB per request (L11; JWT carries `sub` only).
      // goto() is a full navigation: AuthProvider re-hydrates via getCurrentUser.
      await user.goto("/learn/expert-application");
      await expect(user.getByText("You are a verified Expert.")).toBeVisible();
      await expect(user.getByRole("link", { name: "Open the review queue" })).toBeVisible();
      await expect(role(user)).toHaveText("EXPERT");
    });

    await test.step("EXPERT approves a pending article", async () => {
      await user.goto("/learn/review");
      await user.getByRole("link", { name: fixtures.pendingKnowledgeTitle }).click();
      await user.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(user.getByRole("heading", { name: "Article approved" })).toBeVisible();
    });

    await test.step("approved article is public", async () => {
      await user.goto("/learn");
      await expect(user.getByRole("link", { name: fixtures.pendingKnowledgeTitle, exact: true })).toBeVisible();
    });
  } finally {
    await userCtx.close();
    await adminCtx.close();
  }
});
