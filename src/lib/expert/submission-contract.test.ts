import { describe, it, expect } from "vitest";

import * as contract from "@/lib/expert/submission-contract";
import * as backend from "../../../server/src/domain/expert-application-submission.js";

describe("submission contract boundary (single source of truth lives in the backend module)", () => {
  it("re-exports the backend values by identity, never copies", () => {
    expect(contract.EXPERTISE_AREAS).toBe(backend.EXPERTISE_AREAS);
    expect(contract.ACKNOWLEDGEMENT_TEXTS).toBe(backend.ACKNOWLEDGEMENT_TEXTS);
    expect(contract.validateSubmission).toBe(backend.validateSubmission);
    expect(contract.validateDecisionNote).toBe(backend.validateDecisionNote);
    expect(contract.normalizeReferenceUrl).toBe(backend.normalizeReferenceUrl);
    expect(contract.isValidRevision).toBe(backend.isValidRevision);
    expect(contract.EXPERIENCE_MIN_LENGTH).toBe(backend.EXPERIENCE_MIN_LENGTH);
    expect(contract.REJECT_NOTE_MIN_LENGTH).toBe(backend.REJECT_NOTE_MIN_LENGTH);
  });

  it("the displayed acknowledgement is the contract's text for the current version, not a copy", () => {
    expect(contract.CURRENT_ACKNOWLEDGEMENT_TEXT).toBe(
      backend.ACKNOWLEDGEMENT_TEXTS[backend.CURRENT_ACKNOWLEDGEMENT_VERSION as 1],
    );
    expect(contract.CURRENT_ACKNOWLEDGEMENT_TEXT).toMatch(/accurate and complete/);
    expect(contract.CURRENT_ACKNOWLEDGEMENT_TEXT).toMatch(/will not review my own/);
  });

  it("expertiseLabel maps stable keys to labels and shows an unknown key verbatim", () => {
    expect(contract.expertiseLabel("groundwater_wells")).toBe("Groundwater and wells");
    expect(contract.expertiseLabel("future_key")).toBe("future_key");
  });

  it("the shared validator runs in the browser bundle (jsdom) and enforces the same rules", () => {
    const ok = contract.validateSubmission({
      expertiseAreas: ["other"],
      experience: "x".repeat(80),
      acknowledgement: { version: contract.CURRENT_ACKNOWLEDGEMENT_VERSION },
    });
    expect(ok.ok).toBe(true);
    expect(contract.validateSubmission({}).ok).toBe(false);
  });
});
