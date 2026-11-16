import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/client")>()),
  apiRequest: vi.fn().mockResolvedValue({}),
}));

import { apiRequest } from "@/lib/api/client";
import { buildApiUrl } from "@/lib/api/config";
import { executeIssueAction, getIssueWorkflow } from "@/lib/api/issue-workflow";
import { WORKFLOW_ACTIONS, type WorkflowAction } from "@/lib/issues/issue-actions";

const GRANTEE = "507f1f77bcf86cd799439011";
const input = { note: "n", granteeId: GRANTEE };

const EXPECTED: Record<WorkflowAction, [string, Record<string, string>]> = {
  acknowledge: ["/api/v1/issues/i1/acknowledge", { note: "n" }],
  "remediation.grant": ["/api/v1/issues/i1/remediation/grant", { granteeId: GRANTEE, note: "n" }],
  "remediation.withdraw": ["/api/v1/issues/i1/remediation/withdraw", { note: "n" }],
  "remediation.revoke": ["/api/v1/issues/i1/remediation/revoke", { note: "n" }],
  "remediation.accept": ["/api/v1/issues/i1/remediation/accept", {}],
  "remediation.decline": ["/api/v1/issues/i1/remediation/decline", { note: "n" }],
  "remediation.release": ["/api/v1/issues/i1/remediation/release", { note: "n" }],
  "remediation.start": ["/api/v1/issues/i1/start", { note: "n" }],
  "remediation.resolve": ["/api/v1/issues/i1/resolve", { note: "n" }],
  "resolution.verify": ["/api/v1/issues/i1/verify", { note: "n" }],
  "resolution.fail": ["/api/v1/issues/i1/fail-verification", { note: "n" }],
};

describe("issue workflow api", () => {
  beforeEach(() => vi.mocked(apiRequest).mockClear());

  it("covers every current action", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...WORKFLOW_ACTIONS].sort());
  });

  it.each(WORKFLOW_ACTIONS)("%s → endpoint, method, body", async (action) => {
    await executeIssueAction("i1", action, input);
    const [path, body] = EXPECTED[action];
    expect(apiRequest).toHaveBeenCalledWith(buildApiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("omits blank optional notes", async () => {
    await executeIssueAction("i1", "acknowledge", { note: "   ", granteeId: "" });
    expect(apiRequest).toHaveBeenCalledWith(buildApiUrl("/api/v1/issues/i1/acknowledge"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });

  it("reads workflow with signal", async () => {
    const signal = new AbortController().signal;
    await getIssueWorkflow("i1", { signal });
    expect(apiRequest).toHaveBeenCalledWith(buildApiUrl("/api/v1/issues/i1/workflow"), {
      cache: "no-store",
      signal,
    });
  });
});
