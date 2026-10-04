import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { classifyHref, findBrokenLinks, resolveAppRoute } from "@/test-utils/app-routes";

/**
 * Tests the resolver's own rules against a throwaway app tree, so route
 * groups / catch-alls / slots are covered even though src/app has none.
 */
let root: string;
const touch = (rel: string) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "export default function P(){return null}");
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "app-routes-"));
  touch("page.tsx");
  touch("about/page.tsx");
  touch("(marketing)/pricing/page.tsx");
  touch("(marketing)/(promo)/sale/page.tsx");
  touch("posts/[id]/page.tsx");
  touch("posts/new/layout.tsx"); // static dir WITHOUT a page
  touch("docs/[...slug]/page.tsx"); // required catch-all
  touch("help/[[...slug]]/page.tsx"); // optional catch-all
  touch("api/ping/route.ts"); // route handler, not a page
  touch("shop/layout.tsx"); // layout alone is not a route
  touch("@modal/login/page.tsx"); // parallel slot: not a URL segment
  touch("_private/page.tsx"); // private folder: not routable
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const r = (href: string) => resolveAppRoute(href, root);

describe("resolveAppRoute (fixture tree)", () => {
  it("resolves root and static pages", () => {
    expect(r("/")).toBe("static");
    expect(r("/about")).toBe("static");
    expect(r("/about/")).toBe("static");
  });

  it("fails for nonexistent static routes", () => {
    expect(r("/login")).toBe("missing");
    expect(r("/about/team")).toBe("missing");
  });

  it("treats route groups as transparent, never as URL segments", () => {
    expect(r("/pricing")).toBe("static");
    expect(r("/sale")).toBe("static");
    expect(r("/(marketing)/pricing")).toBe("missing");
  });

  it("matches dynamic segments without claiming the concrete path exists on disk", () => {
    expect(r("/posts/123")).toBe("dynamic");
    expect(r("/posts")).toBe("missing"); // no posts/page.tsx
    expect(r("/posts/123/extra")).toBe("missing");
  });

  it("falls through a page-less static dir to a dynamic sibling", () => {
    expect(r("/posts/new")).toBe("dynamic");
  });

  it("reports catch-alls distinctly; they count as implemented routes", () => {
    expect(r("/docs/a/b/c")).toBe("catch-all");
    expect(r("/docs/a/b/c")).not.toBe("missing");
  });

  it("optional catch-all also matches its base path; required catch-all does not", () => {
    expect(r("/help")).toBe("catch-all");
    expect(r("/help/a/b")).toBe("catch-all");
    expect(r("/docs")).toBe("missing");
    expect(r("/docs/a")).toBe("catch-all");
  });

  it("ignores layouts, route handlers, slots and private folders", () => {
    expect(r("/shop")).toBe("missing");
    expect(r("/api/ping")).toBe("missing");
    expect(r("/login")).toBe("missing");
    expect(r("/_private")).toBe("missing");
  });

  it("ignores query strings and fragments", () => {
    expect(r("/about?x=1#top")).toBe("static");
    expect(r("/login?next=/about")).toBe("missing");
  });
});

describe("classifyHref", () => {
  it.each([
    ["/a?b#c", { kind: "internal", pathname: "/a" }],
    ["https://x.dev/a", { kind: "external" }],
    ["mailto:a@b.c", { kind: "external" }],
    ["//cdn.x.dev/a", { kind: "external" }],
    ["#issue-list", { kind: "non-path" }],
    ["?page=2", { kind: "non-path" }],
    ["login", { kind: "non-path" }],
    ["", { kind: "non-path" }],
  ])("%s", (href, expected) => expect(classifyHref(href)).toEqual(expected));

  it("never resolves non-internal hrefs", () => {
    expect(resolveAppRoute("https://x.dev/auth/login")).toBe("missing");
    expect(resolveAppRoute("auth/login")).toBe("missing");
  });
});

describe("findBrokenLinks (real src/app)", () => {
  it("accepts existing static and dynamic routes", () => {
    expect(findBrokenLinks(["/", "/explore", "/auth/login?next=/act", "/act/abc123", "/protected/learn/review/xyz"])).toEqual([]);
  });

  it("flags the pre-#80 bad hrefs", () => {
    expect(findBrokenLinks(["/login", "/register"])).toEqual(["no page serves /login", "no page serves /register"]);
  });

  it("allows only explicitly deferred missing routes, and flags stale deferrals", () => {
    expect(findBrokenLinks(["/not-yet-built"], ["/not-yet-built"])).toEqual([]);
    expect(findBrokenLinks(["/not-yet-built"])).toHaveLength(1);
    expect(findBrokenLinks(["/explore"], ["/explore"])).toEqual(["/explore is listed as deferred but a page now exists"]);
  });
});
