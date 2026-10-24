import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { AuthProvider, useAuth } from "@/components/providers/auth-provider";

const getCurrentUser = vi.fn();
const refreshSession = vi.fn();
const logoutRequest = vi.fn();
const initializeAuthSession = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  getCurrentUser: () => getCurrentUser(),
  refreshSession: () => refreshSession(),
  login: vi.fn(),
  register: vi.fn(),
  logout: () => logoutRequest(),
}));
vi.mock("@/lib/auth-state", () => ({ initializeAuthSession: (d: unknown) => initializeAuthSession(d) }));

type Ctx = ReturnType<typeof useAuth>;
let ctx: Ctx;
function Probe() {
  const value = useAuth();
  // Publish from an effect, not during render (react-hooks/globals).
  React.useEffect(() => {
    ctx = value;
  });
  return (
    <p data-testid="who">
      {value.status}:{value.user?.role ?? "-"}
    </p>
  );
}

const user = (role: string) => ({ id: "u1", name: "Ada", email: "a@example.test", role });

beforeEach(() => {
  getCurrentUser.mockReset();
  refreshSession.mockReset();
  logoutRequest.mockReset();
  initializeAuthSession.mockReset();
  initializeAuthSession.mockResolvedValue({ user: user("USER"), status: "authenticated" });
});

async function mount() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("authenticated:USER"));
}

describe("AuthProvider.refreshUser", () => {
  it("re-reads /auth/me into state (fresh role) WITHOUT rotating tokens or reloading", async () => {
    await mount();
    getCurrentUser.mockResolvedValue(user("EXPERT"));
    let result: unknown;
    await act(async () => {
      result = await ctx.refreshUser();
    });
    expect(result).toMatchObject({ role: "EXPERT" });
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:EXPERT");
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("a failed read resolves null and leaves the session state exactly as it was", async () => {
    await mount();
    getCurrentUser.mockRejectedValue(new Error("boom"));
    let result: unknown = "unset";
    await act(async () => {
      result = await ctx.refreshUser();
    });
    expect(result).toBeNull();
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:USER");
  });

  it("a null user (no session) resolves null without changing state", async () => {
    await mount();
    getCurrentUser.mockResolvedValue(null);
    let result: unknown = "unset";
    await act(async () => {
      result = await ctx.refreshUser();
    });
    expect(result).toBeNull();
    expect(screen.getByTestId("who")).toHaveTextContent("authenticated:USER");
  });

  it("a read superseded by logout is discarded: the late response cannot resurrect the session", async () => {
    await mount();
    let resolveMe!: (u: unknown) => void;
    getCurrentUser.mockReturnValue(new Promise((r) => (resolveMe = r)));
    logoutRequest.mockResolvedValue(undefined);

    let pending!: Promise<unknown>;
    act(() => {
      pending = ctx.refreshUser();
    });
    await act(async () => {
      await ctx.logout();
    });
    expect(screen.getByTestId("who")).toHaveTextContent("anonymous:-");

    await act(async () => {
      resolveMe(user("EXPERT"));
      expect(await pending).toBeNull();
    });
    expect(screen.getByTestId("who")).toHaveTextContent("anonymous:-");
  });
});
