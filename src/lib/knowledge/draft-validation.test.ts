import { describe, it, expect } from "vitest";

import { EMPTY_KNOWLEDGE_DRAFT, validateKnowledgeDraft } from "@/lib/knowledge/draft-validation";

describe("validateKnowledgeDraft", () => {
  it("returns a trimmed payload with exactly title and body", () => {
    expect(validateKnowledgeDraft({ title: " Drip irrigation ", body: " Steps... " })).toEqual({
      ok: true,
      payload: { title: "Drip irrigation", body: "Steps..." },
    });
  });

  it("flags both required fields when empty", () => {
    const r = validateKnowledgeDraft(EMPTY_KNOWLEDGE_DRAFT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["body", "title"]);
  });

  it("treats whitespace-only values as empty", () => {
    const r = validateKnowledgeDraft({ title: "  ", body: "\n\t" });
    expect(r.ok).toBe(false);
  });
});
