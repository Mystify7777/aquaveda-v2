import { expect, test } from "@playwright/test";

import fixtures from "./fixtures.json";

test.describe("public surface (anonymous)", () => {
  test("home renders and primary navigation reaches Explore, Learn and Act", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();

    for (const [label, path, heading] of [
      ["Explore", "/explore", "Explore"],
      ["Learn", "/learn", "Learn"],
      ["Act", "/act", "Act"],
    ] as const) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });

  for (const [surface, listPath, title] of [
    ["Explore -> issue detail", "/explore", fixtures.issueTitle],
    ["Learn -> knowledge detail", "/learn", fixtures.knowledgeTitle],
    ["Act -> project detail", "/act", fixtures.projectTitle],
  ] as const) {
    test(surface, async ({ page }) => {
      await page.goto(listPath);
      await page.getByRole("link", { name: title }).click();
      await expect(page).toHaveURL(new RegExp(`${listPath}/[0-9a-f]{24}$`));
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    });
  }
});
