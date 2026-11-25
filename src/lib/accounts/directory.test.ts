import { describe, expect, it } from "vitest";

import {
  accountDetailHref,
  directoryHref,
  directoryProblems,
  hasDirectoryFilters,
  hasInvalidDirectoryQuery,
  parseDirectoryQuery,
  parsePage,
  searchProblem,
  toApiQuery,
} from "@/lib/accounts/directory";
import type { DirectoryAccountState } from "@/lib/api/types/accounts";
import { DIRECTORY_ROLES, DIRECTORY_STATES, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from "@/lib/accounts/directory-contract";

describe("directory contract boundary (re-exported from the backend domain)", () => {
  it("is the backend's own vocabulary and bounds", () => {
    expect([...DIRECTORY_ROLES]).toEqual(["USER", "EXPERT", "ADMIN"]);
    expect([...DIRECTORY_STATES]).toEqual(["ACTIVE", "MUTED", "HARD_SUSPENDED", "DELETION_PENDING", "PERMANENTLY_DELETED"]);
    expect([SEARCH_MIN_LENGTH, SEARCH_MAX_LENGTH]).toEqual([2, 100]);
  });
});

describe("parseDirectoryQuery: valid queries (unchanged behavior)", () => {
  it("parses valid role, state, q and page", () => {
    expect(parseDirectoryQuery({ role: "EXPERT", accountState: "MUTED", q: "  mira  ", page: "3" })).toEqual({
      filters: { role: "EXPERT", accountState: "MUTED", q: "mira" },
      page: 3,
      invalid: {},
    });
  });

  it("an empty query is valid (page 1, no filters)", () => {
    expect(parseDirectoryQuery({})).toEqual({ filters: {}, page: 1, invalid: {} });
  });

  it("blank values (what the GET form submits for 'Any') mean not set, and are valid", () => {
    expect(parseDirectoryQuery({ role: "", accountState: "", q: "   ", page: "" })).toEqual({ filters: {}, page: 1, invalid: {} });
  });

  it("the boundary values are valid: q of 2 and 100 characters", () => {
    expect(parseDirectoryQuery({ q: "ab" }).invalid).toEqual({});
    expect(parseDirectoryQuery({ q: "x".repeat(100) }).invalid).toEqual({});
  });

  it("the filter state union is exactly the backend's DIRECTORY_STATES", () => {
    const union: Record<DirectoryAccountState, true> = {
      ACTIVE: true,
      MUTED: true,
      HARD_SUSPENDED: true,
      DELETION_PENDING: true,
      PERMANENTLY_DELETED: true,
    };
    expect(Object.keys(union).sort()).toEqual([...DIRECTORY_STATES].sort());
  });
});

describe("parseDirectoryQuery: anything the API would reject is surfaced, not dropped (#181 is .strict())", () => {
  it("an unknown parameter is invalid and listed", () => {
    const q = parseDirectoryQuery({ junk: "x", role: "USER" });
    expect(q.invalid.unknown).toEqual(["junk"]);
    expect(q.filters.role).toBe("USER"); // valid filters are still parsed, but the query as a whole is not sendable
    expect(hasInvalidDirectoryQuery(q.invalid)).toBe(true);
    expect(directoryProblems(q.invalid)).toEqual(["Unknown parameter: junk."]);
    expect(directoryProblems(parseDirectoryQuery({ a: "1", b: "2" }).invalid)).toEqual(["Unknown parameters: a, b."]);
  });

  it("limit and other API-adjacent names the page does not own are unknown too", () => {
    expect(parseDirectoryQuery({ limit: "10" }).invalid.unknown).toEqual(["limit"]);
    expect(parseDirectoryQuery({ page: "2", utm_source: "x" }).invalid.unknown).toEqual(["utm_source"]);
  });

  it("an invalid role is invalid (never dropped to 'any role')", () => {
    const q = parseDirectoryQuery({ role: "ADMN" });
    expect(q.filters.role).toBeUndefined();
    expect(q.invalid.role).toEqual({ value: "ADMN", problem: 'Role "ADMN" is not recognised. Use User, Expert or Admin.' });
    expect(hasInvalidDirectoryQuery(q.invalid)).toBe(true);
  });

  it("an invalid accountState is invalid (never dropped to 'any state')", () => {
    const q = parseDirectoryQuery({ accountState: "BANNED" });
    expect(q.filters.accountState).toBeUndefined();
    expect(q.invalid.accountState?.problem).toBe(
      'Account state "BANNED" is not recognised. Use Active, Muted, Suspended, Deletion pending or Permanently deleted.',
    );
    expect(hasInvalidDirectoryQuery(q.invalid)).toBe(true);
  });

  it.each([["user"], ["Admin"], ["muted"]])("values are case-sensitive exactly like the backend enum: %s is invalid for role and state", (value) => {
    expect(hasInvalidDirectoryQuery(parseDirectoryQuery({ role: value }).invalid)).toBe(true);
    expect(hasInvalidDirectoryQuery(parseDirectoryQuery({ accountState: value }).invalid)).toBe(true);
  });

  it("an invalid q is invalid (too short / too long), as before", () => {
    const short = parseDirectoryQuery({ q: "a" });
    expect(short.filters.q).toBeUndefined();
    expect(short.invalid.q).toEqual({ value: "a", problem: "Search needs at least 2 characters." });
    expect(parseDirectoryQuery({ q: "x".repeat(101) }).invalid.q?.problem).toBe("Search can be at most 100 characters.");
    expect(searchProblem("ab")).toBeNull();
  });

  it("a repeated parameter is invalid (the API accepts one value); its first value is not also validated", () => {
    const q = parseDirectoryQuery({ role: ["ADMIN", "USER"], page: ["2", "5"] });
    expect(q.invalid.repeated).toEqual(["role", "page"]);
    expect(q.invalid.role).toBeUndefined();
    expect(q.filters.role).toBeUndefined();
    expect(directoryProblems(q.invalid)).toEqual(["Only one value is allowed for: role, page."]);
  });

  it.each([["0"], ["-2"], ["1.5"], ["abc"]])("page %j is invalid, not coerced to 1", (raw) => {
    const q = parseDirectoryQuery({ page: raw });
    expect(q.invalid.page).toEqual({ value: raw, problem: "Page must be a positive whole number." });
    expect(q.page).toBe(1);
    expect(hasInvalidDirectoryQuery(q.invalid)).toBe(true);
  });

  it.each([["7", 7], [" 4 ", 4], ["1e1", 10]])("page %j is valid (the backend's Number()-integer rule) -> %i", (raw, expected) => {
    expect(parseDirectoryQuery({ page: raw })).toMatchObject({ page: expected, invalid: {} });
  });

  it("several problems are all reported, in a stable order", () => {
    const q = parseDirectoryQuery({ zzz: "1", role: ["A", "B"], accountState: "X", q: "a", page: "0" });
    expect(directoryProblems(q.invalid)).toEqual([
      "Unknown parameter: zzz.",
      "Only one value is allowed for: role.",
      expect.stringContaining('Account state "X"'),
      "Search needs at least 2 characters.",
      "Page must be a positive whole number.",
    ]);
  });

  it("the detail page's history page parser stays lenient (a different, smaller surface)", () => {
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage(["4"])).toBe(4);
  });
});

describe("serialization and API query", () => {
  it("fixed order role, accountState, q, page; inactive filters and page 1 omitted", () => {
    expect(directoryHref({ q: "mira", accountState: "MUTED", role: "USER" }, 4)).toBe(
      "/admin/accounts?role=USER&accountState=MUTED&q=mira&page=4",
    );
    expect(directoryHref({})).toBe("/admin/accounts");
    expect(directoryHref({ role: "ADMIN" }, 1)).toBe("/admin/accounts?role=ADMIN");
    expect(directoryHref({}, 2)).toBe("/admin/accounts?page=2");
  });

  it("round-trips through the parser", () => {
    const href = directoryHref({ role: "EXPERT", accountState: "ACTIVE", q: "a&b c" }, 2);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseDirectoryQuery(params)).toMatchObject({ filters: { role: "EXPERT", accountState: "ACTIVE", q: "a&b c" }, page: 2 });
  });

  it("toApiQuery sends exactly the backend's parameters", () => {
    expect(toApiQuery({ filters: { role: "USER", q: "mira" }, page: 2 })).toEqual({ page: 2, role: "USER", q: "mira" });
    expect(Object.keys(toApiQuery({ filters: {}, page: 1 }))).toEqual(["page"]);
  });

  it("hasDirectoryFilters and detail hrefs", () => {
    expect(hasDirectoryFilters({})).toBe(false);
    expect(hasDirectoryFilters({ q: "ab" })).toBe(true);
    expect(accountDetailHref("abc")).toBe("/admin/accounts/abc");
    expect(accountDetailHref("a/b", 3)).toBe("/admin/accounts/a%2Fb?page=3");
  });
});
