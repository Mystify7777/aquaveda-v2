import { describe, it, expect } from "vitest";

import { matchNavPath } from "@/lib/navigation";

describe("matchNavPath", () => {
  it("returns 'page' for an exact match, ignoring a trailing slash", () => {
    expect(matchNavPath("/explore", "/explore")).toBe("page");
    expect(matchNavPath("/explore/", "/explore")).toBe("page");
    expect(matchNavPath("/explore", "/explore/")).toBe("page");
  });

  it("returns 'section' for nested routes on a whole-segment boundary", () => {
    expect(matchNavPath("/explore/abc123", "/explore")).toBe("section");
    expect(matchNavPath("/learn/new", "/learn")).toBe("section");
    expect(matchNavPath("/learn/mine/", "/learn")).toBe("section");
  });

  it("never matches a path that only shares a string prefix", () => {
    expect(matchNavPath("/exploreX", "/explore")).toBeNull();
    expect(matchNavPath("/actions", "/act")).toBeNull();
    expect(matchNavPath("/community-guidelines", "/community")).toBeNull();
  });

  it("does not match unrelated or parent routes", () => {
    expect(matchNavPath("/learn", "/explore")).toBeNull();
    expect(matchNavPath("/", "/explore")).toBeNull();
    expect(matchNavPath("/explore", "/explore/abc")).toBeNull();
  });

  it("matches the root only against itself", () => {
    expect(matchNavPath("/", "/")).toBe("page");
    expect(matchNavPath("/explore", "/")).toBeNull();
  });

  it("is safe for missing pathnames", () => {
    expect(matchNavPath(null, "/explore")).toBeNull();
    expect(matchNavPath(undefined, "/explore")).toBeNull();
    expect(matchNavPath("", "/explore")).toBeNull();
  });
});
