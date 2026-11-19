import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { AuthProvider, useAuth } from "@/components/providers/auth-provider";

const getCurrentUser = vi.fn();
const refreshSession = vi.fn();
const logoutRequest = vi.fn();
const initializeAuthSessionWithRetry = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  getCurrentUser: () => getCurrentUser(),
  refreshSession: () => refreshSession(),
  login: vi.fn(),
  register: vi.fn(),
  logout: () => logoutRequest(),
}));
vi.mock("@/lib/auth-state", () => ({
  initializeAuthSessionWithRetry: (d: unknown) => initializeAuthSessionWithRetry(d),
}));

type Ctx = ReturnType<typeof useAuth>;
let ctx: Ctx;
function Probe() {
  const value = useAuth();
  React.useEffect(() => { ctx = value; });
  return <p data-testid="who">{value.status}:{value.user?.role ?? "-"}</p>;
}

const user = (role: string) => ({ id: "u1", name: "Ada", email: "a@example.test", role });

beforeEach(() => {
  getCurrentUser.mockReset();
  refreshSession.mockReset();
  logoutRequest.mockReset();
  initializeAuthSessionWithRetry.mockReset();
  initializeAuthSessionWithRetry.mockResolvedValue({ user: user("USER"), status: "authenticated" });
});

async function mount() {
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("authenticated:USER"));
}

describe("AuthProvider.refreshUser", () => {
  it("re-reads /auth/me into state (fresh role) WITHOUT rotating tokens or reloading", async () => {
    await mount();
    getCurrentUser.mockResolvedValue(user("EXPERT"));
    let result: unknown;
    await act(async () => { result = await ctx.refreshUser(); });
    expect(result).toMatchObject({ role: "EXPERT" });
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:EXPERT");
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("a failed read resolves null and leaves the session state exactly as it was", async () => {
    await mount();
    getCurrentUser.mockRejectedValue(new Error("boom"));
    let result: unknown = "unset";
    await act(async () => { result = await ctx.refreshUser(); });
    expect(result).toBeNull();
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:USER");
  });

  it("a null user (no session) resolves null without changing state", async () => {
    await mount();
    getCurrentUser.mockResolvedValue(null);
    let result: unknown = "unset";
    await act(async () => { result = await ctx.refreshUser(); });
    expect(result).toBeNull();
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:USER");
  });

  it("a read superseded by logout is discarded", async () => {
    await mount();
    let resolveMe!: (u: unknown) => void;
    getCurrentUser.mockReturnValue(new Promise((r) => (resolveMe = r)));
    logoutRequest.mockResolvedValue(undefined);

    let pending!: Promise<unknown>;
    act(() => { pending = ctx.refreshUser(); });
    await act(async () => { await ctx.logout(); });
    expect(screen.getByTestId("who")).toHaveTextContent("anonymous:-");

    await act(async () => {
      resolveMe(user("EXPERT"));
      expect(await pending).toBeNull();
    });
    expect(screen.getByTestId("who")).toHaveTextContent("anonymous:-");
  });
});

describe("AuthProvider bootstrap retry integration", () => {
  it("runs the bounded recovery policy and applies an authenticated result without reload", async () => {
    initializeAuthSessionWithRetry.mockResolvedValueOnce({
      status: "authenticated",
      user: user("USER"),
    });
    await mount();
    expect(initializeAuthSessionWithRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:USER");
  });

  it("manual retry transitions unavailable through initializing and recovers shared auth state", async () => {
    initializeAuthSessionWithRetry
      .mockResolvedValueOnce({ status: "unavailable", user: null })
      .mockResolvedValueOnce({ status: "authenticated", user: user("EXPERT") });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("unavailable:-"));

    await act(async () => { await ctx.retryInitialization(); });
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:EXPERT");
    expect(initializeAuthSessionWithRetry).toHaveBeenCalledTimes(2);
  });

  it("manual retry retains explicit unavailable when backend still cannot be reached", async () => {
    initializeAuthSessionWithRetry
      .mockResolvedValueOnce({ status: "unavailable", user: null })
      .mockResolvedValueOnce({ status: "unavailable", user: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("unavailable:-"));

    await act(async () => { await ctx.retryInitialization(); });
    expect(screen.getByTestId("who")).toHaveTextContent("unavailable:-");
    expect(initializeAuthSessionWithRetry).toHaveBeenCalledTimes(2);
  });

  it("does not start overlapping manual retries", async () => {
    let resolveRetry!: (value: unknown) => void;
    initializeAuthSessionWithRetry
      .mockResolvedValueOnce({ status: "unavailable", user: null })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("unavailable:-"));

    let first!: Promise<void>;
    await act(async () => {
      first = ctx.retryInitialization();
      await Promise.resolve();
      await ctx.retryInitialization();
    });
    expect(initializeAuthSessionWithRetry).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveRetry({ status: "authenticated", user: user("USER") });
      await first;
    });
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:USER");
  });
});
