import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import {
  EXPERT_STATUS_STALE_AFTER_MS,
  ExpertStatusProvider,
  useExpertStatus,
} from "@/components/expert/expert-status-provider";
import { ApiError } from "@/lib/api/client";
import type { MyExpertApplication } from "@/lib/api/types/expert-application";

const mockMine = vi.fn();
const mockList = vi.fn();
vi.mock("@/lib/api/expert-application", () => ({
  getMyExpertApplication: () => mockMine(),
  getPendingExpertApplications: (q: unknown) => mockList(q),
}));
const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const as = (role: string | null, id = "u1", status = "authenticated") =>
  mockUseAuth.mockReturnValue({ status, user: role ? { id, role } : null });
const app = (status: MyExpertApplication["status"]): MyExpertApplication => ({ status, history: [] });

type Value = ReturnType<typeof useExpertStatus>;
let latest: Value;
function Probe() {
  const value = useExpertStatus();
  // Publish from an effect, not during render (react-hooks/globals).
  React.useEffect(() => {
    latest = value;
  });
  return (
    <p data-testid="s">
      {value.scope}|{value.status}|{value.application?.status ?? "-"}|{value.pendingCount ?? "-"}|{value.stale ? "stale" : "fresh"}
    </p>
  );
}
const ui = () => (
  <React.StrictMode>
    <ExpertStatusProvider>
      <Probe />
    </ExpertStatusProvider>
  </React.StrictMode>
);
const text = () => screen.getByTestId("s").textContent;
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  mockMine.mockReset();
  mockList.mockReset();
  mockUseAuth.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("ExpertStatusProvider: what is fetched", () => {
  it("USER: one GET /me even under React Strict Mode's double effect", async () => {
    as("USER");
    mockMine.mockResolvedValue(app("pending"));
    render(ui());
    await waitFor(() => expect(text()).toBe("user|ready|pending|-|fresh"));
    expect(mockMine).toHaveBeenCalledTimes(1);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("ADMIN: queue with limit=1, reading `total` (not the page size)", async () => {
    as("ADMIN");
    mockList.mockResolvedValue({ items: [{}], page: 1, limit: 1, total: 7, totalPages: 7 });
    render(ui());
    await waitFor(() => expect(text()).toBe("admin|ready|-|7|fresh"));
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith({ page: 1, limit: 1 });
    expect(mockMine).not.toHaveBeenCalled();
  });

  it.each([["EXPERT"], [null]])("%s / anonymous: nothing is fetched, status stays idle", async (role) => {
    as(role as string | null, "u1", role ? "authenticated" : "anonymous");
    render(ui());
    expect(text()).toBe("none|idle|-|-|fresh");
    expect(mockMine).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("does not fetch before the session is authenticated", () => {
    as("USER", "u1", "initializing");
    render(ui());
    expect(mockMine).not.toHaveBeenCalled();
    expect(text()).toBe("none|idle|-|-|fresh");
  });
});

describe("ExpertStatusProvider: identity and supersession", () => {
  it("a late response for the PREVIOUS account is dropped after an account switch", async () => {
    as("USER", "alice");
    const slow = deferred<MyExpertApplication>();
    mockMine.mockReturnValueOnce(slow.promise);
    const { rerender } = render(ui());

    as("USER", "bob");
    mockMine.mockResolvedValueOnce(app("approved"));
    rerender(ui());
    await waitFor(() => expect(text()).toBe("user|ready|approved|-|fresh"));

    await act(async () => {
      slow.resolve(app("rejected")); // alice's answer arrives late
      await slow.promise;
    });
    expect(text()).toBe("user|ready|approved|-|fresh"); // still bob's
  });

  it("the old identity's data is not shown while the new identity loads", async () => {
    as("USER", "alice");
    mockMine.mockResolvedValueOnce(app("pending"));
    const { rerender } = render(ui());
    await waitFor(() => expect(text()).toBe("user|ready|pending|-|fresh"));

    as("USER", "bob");
    const bob = deferred<MyExpertApplication>();
    mockMine.mockReturnValueOnce(bob.promise);
    rerender(ui());
    expect(text()).toBe("user|loading|-|-|fresh");
    await act(async () => {
      bob.resolve(app("none"));
      await bob.promise;
    });
    await waitFor(() => expect(text()).toBe("user|ready|none|-|fresh"));
  });

  it("a role change (e.g. USER -> EXPERT after approval) hides USER data and stops fetching", async () => {
    as("USER");
    mockMine.mockResolvedValue(app("approved"));
    const { rerender } = render(ui());
    await waitFor(() => expect(text()).toBe("user|ready|approved|-|fresh"));
    as("EXPERT");
    rerender(ui());
    expect(text()).toBe("none|idle|-|-|fresh");
  });

  it("an explicit refresh supersedes an older in-flight read: the older response can never overwrite it", async () => {
    as("USER");
    const first = deferred<MyExpertApplication>();
    mockMine.mockReturnValueOnce(first.promise);
    render(ui());
    await waitFor(() => expect(mockMine).toHaveBeenCalledTimes(1));

    mockMine.mockResolvedValueOnce(app("pending"));
    await act(async () => {
      await latest.refresh();
    });
    expect(text()).toBe("user|ready|pending|-|fresh");

    await act(async () => {
      first.resolve(app("none")); // the pre-mutation answer arrives last
      await first.promise;
    });
    expect(text()).toBe("user|ready|pending|-|fresh");
  });

  it("setApplication installs an authoritative result and drops an older in-flight read", async () => {
    as("USER");
    const first = deferred<MyExpertApplication>();
    mockMine.mockReturnValueOnce(first.promise);
    render(ui());
    await waitFor(() => expect(mockMine).toHaveBeenCalledTimes(1));

    act(() => latest.setApplication(app("pending")));
    expect(text()).toBe("user|ready|pending|-|fresh");
    await act(async () => {
      first.resolve(app("none"));
      await first.promise;
    });
    expect(text()).toBe("user|ready|pending|-|fresh");
  });

  it("setApplication is a no-op outside the USER scope", async () => {
    as("ADMIN");
    mockList.mockResolvedValue({ items: [], page: 1, limit: 1, total: 2, totalPages: 2 });
    render(ui());
    await waitFor(() => expect(text()).toBe("admin|ready|-|2|fresh"));
    act(() => latest.setApplication(app("pending")));
    expect(text()).toBe("admin|ready|-|2|fresh");
  });
});

describe("ExpertStatusProvider: failure semantics", () => {
  it("no prior data: error (never presented as a status)", async () => {
    as("USER");
    mockMine.mockRejectedValue(new ApiError("x", "http", 500));
    render(ui());
    await waitFor(() => expect(text()).toBe("user|error|-|-|fresh"));
    expect(latest.error?.status).toBe(500);
  });

  it("prior data + failed refresh: kept but flagged stale; a later success clears it", async () => {
    as("USER");
    mockMine.mockResolvedValueOnce(app("pending"));
    render(ui());
    await waitFor(() => expect(text()).toBe("user|ready|pending|-|fresh"));

    mockMine.mockRejectedValueOnce(new ApiError("x", "network"));
    await act(async () => {
      await latest.refresh();
    });
    expect(text()).toBe("user|ready|pending|-|stale");

    mockMine.mockResolvedValueOnce(app("approved"));
    await act(async () => {
      await latest.refresh();
    });
    expect(text()).toBe("user|ready|approved|-|fresh");
  });

  it("a 401 surfaces as an error carrying the status so UIs can offer sign-in", async () => {
    as("ADMIN");
    mockList.mockRejectedValue(new ApiError("x", "http", 401));
    render(ui());
    await waitFor(() => expect(text()).toBe("admin|error|-|-|fresh"));
    expect(latest.error?.status).toBe(401);
  });
});

describe("ExpertStatusProvider: visibility refresh (no polling)", () => {
  function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("re-reads when the tab becomes visible after the stale window, not before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-03-05T10:00:00Z"));
    as("USER");
    mockMine.mockResolvedValue(app("pending"));
    render(ui());
    await waitFor(() => expect(text()).toBe("user|ready|pending|-|fresh"));
    expect(mockMine).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + EXPERT_STATUS_STALE_AFTER_MS - 5_000));
    act(() => setVisibility("visible"));
    expect(mockMine).toHaveBeenCalledTimes(1); // too soon

    vi.setSystemTime(new Date(Date.now() + 10_000));
    mockMine.mockResolvedValueOnce(app("approved"));
    act(() => setVisibility("hidden"));
    expect(mockMine).toHaveBeenCalledTimes(1); // hidden never refreshes
    act(() => setVisibility("visible"));
    await waitFor(() => expect(text()).toBe("user|ready|approved|-|fresh"));
    expect(mockMine).toHaveBeenCalledTimes(2);
  });
});

describe("useExpertStatus outside the provider", () => {
  it("is idle and inert, so isolated surfaces keep working", () => {
    render(<Probe />);
    expect(text()).toBe("none|idle|-|-|fresh");
  });
});
