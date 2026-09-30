import { describe, it, expect } from "vitest";

import { validateProjectCreation } from "@/lib/projects/creation-validation";

const ID = "507f1f77bcf86cd799439011";

describe("validateProjectCreation", () => {
  it("requires title, description and originIssue", () => {
    const r = validateProjectCreation({ title: " ", description: "", originIssue: "  " });
    expect(r).toEqual({
      ok: false,
      errors: {
        title: "Title is required.",
        description: "Description is required.",
        originIssue: "Origin issue ID is required.",
      },
    });
  });

  it("rejects a malformed originIssue", () => {
    const r = validateProjectCreation({ title: "T", description: "D", originIssue: "abc" });
    expect(r).toMatchObject({ ok: false, errors: { originIssue: expect.stringMatching(/24-character/) } });
  });

  it("builds exactly { title, description, originIssue }, trimmed", () => {
    const r = validateProjectCreation({ title: " T ", description: " D ", originIssue: ` ${ID} ` });
    expect(r).toEqual({ ok: true, payload: { title: "T", description: "D", originIssue: ID } });
  });
});
