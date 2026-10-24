import { describe, it, expect } from "vitest";

import { CURRENT_ACKNOWLEDGEMENT_VERSION } from "@/lib/expert/submission-contract";
import {
  draftFromSubmission,
  draftToRequest,
  emptyDraft,
  firstInvalidField,
  validateDraft,
  type SubmissionDraft,
} from "@/lib/expert/submission-form";

const valid = (over: Partial<SubmissionDraft> = {}): SubmissionDraft => ({
  expertiseAreas: ["groundwater_wells"],
  experience: "x".repeat(80),
  affiliation: "",
  references: [],
  acknowledged: true,
  ...over,
});

describe("draftToRequest", () => {
  it("omits blank affiliation and blank reference rows rather than sending empties", () => {
    const req = draftToRequest(valid({ affiliation: "   ", references: ["", "  ", "https://a.org"] }));
    expect(req).not.toHaveProperty("affiliation");
    expect(req.references).toEqual(["https://a.org"]);
  });

  it("sends the acknowledgement VERSION only, and only when accepted", () => {
    expect(draftToRequest(valid()).acknowledgement).toEqual({ version: CURRENT_ACKNOWLEDGEMENT_VERSION });
    expect(draftToRequest(valid({ acknowledged: false }))).not.toHaveProperty("acknowledgement");
  });
});

describe("validateDraft (shared contract rules)", () => {
  it("accepts a valid draft and returns the normalized request", () => {
    const r = validateDraft(valid({ experience: `  ${"x".repeat(80)}  `, affiliation: " Trust " }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.experience).toBe("x".repeat(80));
      expect(r.request.affiliation).toBe("Trust");
    }
  });

  it("an empty draft reports every required field", () => {
    const r = validateDraft(emptyDraft());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["acknowledgement", "experience", "expertiseAreas"]);
  });

  it("maps a reference error to the DRAFT row even when blank rows precede it", () => {
    const r = validateDraft(valid({ references: ["", "http://insecure.org", "https://ok.org"] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors)).toEqual(["references.1"]);
      expect(r.errors["references.1"]).toMatch(/https/);
    }
  });

  it("rejects unaccepted acknowledgement, short experience and over-limit areas with the contract's messages", () => {
    const r = validateDraft(
      valid({ experience: "short", acknowledged: false, expertiseAreas: ["other", "policy_governance", "groundwater_wells", "wastewater_sanitation"] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.experience).toMatch(/at least 80/);
      expect(r.errors.acknowledgement).toMatch(/must be accepted/);
      expect(r.errors.expertiseAreas).toMatch(/between 1 and 3/);
    }
  });
});

describe("draftFromSubmission (re-apply starting point)", () => {
  it("prefills content but NEVER the acknowledgement", () => {
    const d = draftFromSubmission({
      expertiseAreas: ["other"],
      experience: "e".repeat(90),
      affiliation: "Trust",
      references: ["https://a.org/"],
      acknowledgement: { version: 1, acceptedAt: "2026-03-05T10:00:00.000Z" },
    });
    expect(d).toMatchObject({ expertiseAreas: ["other"], affiliation: "Trust", references: ["https://a.org/"] });
    expect(d.acknowledged).toBe(false);
  });

  it("legacy (null) and absent submissions start empty", () => {
    expect(draftFromSubmission(null)).toEqual(emptyDraft());
    expect(draftFromSubmission(undefined)).toEqual(emptyDraft());
  });

  it("does not alias the submission's arrays", () => {
    const sub = { expertiseAreas: ["other"], experience: "e".repeat(90), references: ["https://a.org/"] };
    const d = draftFromSubmission(sub);
    d.expertiseAreas.push("x");
    expect(sub.expertiseAreas).toEqual(["other"]);
  });
});

describe("firstInvalidField", () => {
  it("follows form order", () => {
    expect(firstInvalidField({ acknowledgement: "a", experience: "e" }, 0)).toBe("experience");
    expect(firstInvalidField({ "references.1": "r", acknowledgement: "a" }, 2)).toBe("references.1");
    expect(firstInvalidField({}, 0)).toBeNull();
  });
});
