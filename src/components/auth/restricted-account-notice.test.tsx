import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RestrictedAccountNotice } from "@/components/auth/restricted-account-notice";
import { LoadError } from "@/components/ui/load-error";
import { ApiError } from "@/lib/api/client";

const mockLogout = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => ({ logout: mockLogout }) }));

const err = (code: string, status = 403) => new ApiError("raw backend text", "http", status, code);

beforeEach(() => mockLogout.mockReset());

describe("RestrictedAccountNotice", () => {
  it("muted: explains contribution restriction, preserves reading, no sign-out, no appeal", () => {
    render(<RestrictedAccountNotice restriction="muted" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-restriction", "muted");
    expect(screen.getByRole("heading", { name: "Your account is muted" })).toBeInTheDocument();
    expect(alert).toHaveTextContent(/still read and browse/);
    expect(alert).toHaveTextContent(/posting, reporting and other contributions are paused/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument(); // no invented appeal/recovery path
  });

  it("suspended: explains suspension and offers the existing sign-out", async () => {
    mockLogout.mockResolvedValue(undefined);
    render(<RestrictedAccountNotice restriction="suspended" />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-restriction", "suspended");
    expect(screen.getByRole("heading", { name: "Your account is suspended" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("suspended: a failed sign-out is reported and can be retried", async () => {
    mockLogout.mockRejectedValueOnce(new Error("net")).mockResolvedValueOnce(undefined);
    render(<RestrictedAccountNotice restriction="suspended" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText(/could not sign you out/)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Sign out" });
    expect(retry).toBeEnabled();
    await userEvent.click(retry);
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(2));
  });
});

describe("LoadError with an account-restriction failure", () => {
  it("ACCOUNT_MUTED replaces the generic alert and never shows raw backend text", () => {
    render(<LoadError message="generic" error={err("ACCOUNT_MUTED")} retryHref="/x" signIn />);
    expect(screen.getByRole("heading", { name: "Your account is muted" })).toBeInTheDocument();
    expect(screen.queryByText("generic")).not.toBeInTheDocument();
    expect(screen.queryByText(/raw backend text/)).not.toBeInTheDocument();
  });

  it("ACCOUNT_SUSPENDED shows suspension + sign out", () => {
    render(<LoadError message="generic" error={err("ACCOUNT_SUSPENDED")} />);
    expect(screen.getByRole("heading", { name: "Your account is suspended" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("generic 403, 401, 500 and no error: the existing alert is unchanged", () => {
    for (const error of [err("FORBIDDEN"), err("UNAUTHORIZED", 401), new ApiError("x", "http", 500), undefined]) {
      const { unmount } = render(<LoadError message="generic message" error={error} retryHref="/x" />);
      expect(screen.getByRole("alert")).toHaveTextContent("generic message");
      expect(screen.getByRole("link", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByText(/Your account is (muted|suspended)/)).not.toBeInTheDocument();
      unmount();
    }
  });
});
