import { describe, it, expect } from "vitest";

import {
  ADMIN_EXPERT_APPLICATIONS_HREF,
  EXPERT_APPLICATION_HREF,
  EXPERT_ATTENTION_HREF,
  KNOWLEDGE_REVIEW_HREF,
  getRoleLinks,
} from "@/lib/expert/role-links";

describe("getRoleLinks", () => {
  it("USER: the Expert application entry only", () => {
    expect(getRoleLinks("USER")).toEqual([{ href: EXPERT_APPLICATION_HREF, label: "Become an Expert" }]);
  });

  it("EXPERT: both distinct review and Issue attention queues", () => {
    expect(getRoleLinks("EXPERT")).toEqual([
      { href: KNOWLEDGE_REVIEW_HREF, label: "Review queue" },
      { href: EXPERT_ATTENTION_HREF, label: "Needs attention" },
    ]);
  });

  it("ADMIN: Expert-application governance only — never EXPERT queues", () => {
    const links = getRoleLinks("ADMIN");
    expect(links).toEqual([{ href: ADMIN_EXPERT_APPLICATIONS_HREF, label: "Expert applications" }]);
    expect(links.some((l) => l.href === KNOWLEDGE_REVIEW_HREF || l.href === EXPERT_ATTENTION_HREF)).toBe(false);
  });

  it("no links for anonymous, unknown, or malformed roles (no default-allow)", () => {
    for (const role of [undefined, null, "", "user", "SUPERUSER", "ADMIN ", "expert"]) {
      expect(getRoleLinks(role)).toEqual([]);
    }
  });

  it("each role's links are disjoint (roles are not interchangeable)", () => {
    const all = ["USER", "EXPERT", "ADMIN"].flatMap((r) => getRoleLinks(r).map((l) => l.href));
    expect(new Set(all).size).toBe(all.length);
  });
});
