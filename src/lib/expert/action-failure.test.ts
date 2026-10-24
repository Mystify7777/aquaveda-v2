import { describe, it, expect } from "vitest";

import { ApiError } from "@/lib/api/client";
import { toExpertActionFailure } from "@/lib/expert/action-failure";

const http = (status: number, code?: string) => new ApiError("x", "http", status, code);

describe("toExpertActionFailure", () => {
  it("a stale decision (STATE_RACE) explains that it changed while reviewing, and is 'stale' so the view refreshes", () => {
    const f = toExpertActionFailure(http(409, "STATE_RACE"), "decide");
    expect(f.kind).toBe("stale");
    expect(f.message).toMatch(/changed while you were reviewing/);
  });

  it("INVALID_STATE on a decision means already decided", () => {
    const f = toExpertActionFailure(http(409, "INVALID_STATE"), "decide");
    expect(f.kind).toBe("stale");
    expect(f.message).toMatch(/no longer pending/);
  });

  it("429 is a calm 'too many attempts' message for both actions, not stale", () => {
    for (const action of ["apply", "decide"] as const) {
      const f = toExpertActionFailure(http(429), action);
      expect(f.kind).toBe("other");
      expect(f.message).toMatch(/too many attempts/i);
    }
  });

  it("apply + STATE_RACE/INVALID_STATE keeps the 'already in progress' copy", () => {
    expect(toExpertActionFailure(http(409, "INVALID_STATE"), "apply").message).toMatch(/already have an application in progress/);
  });

  it("session, validation, forbidden and network outcomes are unchanged", () => {
    expect(toExpertActionFailure(http(401), "apply").kind).toBe("session");
    expect(toExpertActionFailure(new ApiError("bad field", "http", 400, "VALIDATION_FAILED"), "apply").message).toBe("bad field");
    expect(toExpertActionFailure(http(403), "decide").message).toMatch(/not permitted/);
    expect(toExpertActionFailure(new ApiError("down", "network"), "apply").message).toMatch(/unreachable/);
  });
});
