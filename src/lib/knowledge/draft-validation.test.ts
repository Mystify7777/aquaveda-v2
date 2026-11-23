import { describe, it, expect } from "vitest";

import { EMPTY_KNOWLEDGE_DRAFT, validateKnowledgeDraft } from "@/lib/knowledge/draft-validation";

describe("validateKnowledgeDraft", () => {
  it("returns a trimmed payload and taxonomy selection", () => {
    expect(validateKnowledgeDraft({ title: " Drip irrigation ", body: " Steps... ", category: "agriculture_irrigation", topics: ["efficient_irrigation"] })).toEqual({
      ok: true,
      payload: { title: "Drip irrigation", body: "Steps...", category: "agriculture_irrigation", topics: ["efficient_irrigation"] },
    });
  });

  it("flags all required values when empty", () => {
    const result = validateKnowledgeDraft(EMPTY_KNOWLEDGE_DRAFT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["body", "category", "title"]);
  });

  it("treats whitespace-only title and body as empty", () => {
    const result = validateKnowledgeDraft({ title: "  ", body: "\n\t", category: "other", topics: [] });
    expect(result.ok).toBe(false);
  });

  it("deduplicates optional Topics deterministically and preserves selected order", () => {
    expect(validateKnowledgeDraft({
      title: "Title", body: "Body", category: "other",
      topics: ["rainwater_harvesting", "efficient_irrigation", "rainwater_harvesting"],
    })).toMatchObject({ ok: true, payload: { topics: ["rainwater_harvesting", "efficient_irrigation"] } });
  });

  it("requires one Category selection", () => {
    const result = validateKnowledgeDraft({ title: "Title", body: "Body", category: "", topics: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.category).toBe("Choose a Category.");
  });
});
