import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AccountRestrictionBanner } from "@/components/auth/account-restriction-banner";
import { RequireAuth } from "@/components/auth/require-auth";
import { AuthControls } from "@/components/layout/auth-controls";

const mockUseAuth = vi.fn();
const logout = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));

const auth = (over: Record<string, unknown>) =>
  mockUseAuth.mockReturnValue({ status: "authenticated", user: { id: "u1", role: "USER" }, restriction: null, logout, retryInitialization: vi.fn(), ...over });

beforeEach(() => {
  mockUseAuth.mockReset();
  logout.mockReset();
});

describe("AccountRestrictionBanner (reuses the #248 notice)", () => {
  it("renders nothing without a restriction (active, anonymous, loading, failure)", () => {
    for (const status of ["authenticated", "anonymous", "initializing", "session-failure", "unavailable"]) {
      auth({ status, restriction: null });
      const { container, unmount } = render(<AccountRestrictionBanner />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("muted: a polite status with the muted wording, reading preserved, no sign-out", () => {
    auth({ restriction: "muted" });
    render(<AccountRestrictionBanner />);
    const notice = screen.getByRole("status");
    expect(notice).toHaveAttribute("data-restriction", "muted");
    expect(screen.getByRole("heading", { name: "Your account is muted" })).toBeInTheDocument();
    expect(notice).toHaveTextContent(/still read and browse/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("suspended: an alert with the suspended wording and the existing sign-out", async () => {
    logout.mockResolvedValue(undefined);
    auth({ status: "suspended", user: null, restriction: "suspended" });
    render(<AccountRestrictionBanner />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-restriction", "suspended");
    expect(screen.getByRole("heading", { name: "Your account is suspended" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe("RequireAuth with a bootstrap-suspended session", () => {
  it("never renders protected children; not a sign-in or retry prompt", () => {
    auth({ status: "suspended", user: null, restriction: "suspended" });
    render(<RequireAuth><p>secret content</p></RequireAuth>);
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/suspended/);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("muted stays authenticated: children render", () => {
    auth({ restriction: "muted" });
    render(<RequireAuth><p>contribute</p></RequireAuth>);
    expect(screen.getByText("contribute")).toBeInTheDocument();
  });
});

describe("AuthControls", () => {
  it("suspended: shows the account status and a working Sign out, not Sign in / 'Session unavailable'", async () => {
    logout.mockResolvedValue(undefined);
    auth({ status: "suspended", user: null, restriction: "suspended" });
    render(<AuthControls />);
    expect(screen.getByLabelText("Account status")).toHaveTextContent("Suspended");
    expect(screen.queryByText("Session unavailable")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("muted: unchanged signed-in controls (role + Sign out)", () => {
    auth({ restriction: "muted" });
    render(<AuthControls />);
    expect(screen.getByLabelText("Signed-in role")).toHaveTextContent("USER");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
