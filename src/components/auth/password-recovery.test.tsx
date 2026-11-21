import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api/client";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => ({ register: mocks.register }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams("token=opaque-test-token"),
}));
vi.mock("@/lib/api/auth", () => ({
  requestPasswordReset: mocks.requestPasswordReset,
  resetPassword: mocks.resetPassword,
}));

import { RegisterForm } from "@/components/auth/register-form";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

describe("password recovery and confirmation UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.register.mockResolvedValue(undefined);
    mocks.requestPasswordReset.mockResolvedValue(null);
    mocks.resetPassword.mockResolvedValue(null);
    window.history.replaceState({}, "", "/auth/reset-password?token=opaque-test-token");
  });

  it("announces registration mismatch and blocks submission without sending confirmation", async () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A Person" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-password" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-describedby", "register-confirm-password-error");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("sends only the primary password when registration confirmation matches", async () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "A Person" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "long-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "long-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith({
      name: "A Person", email: "person@example.test", password: "long-password",
    }));
    expect(mocks.register.mock.calls[0][0]).not.toHaveProperty("confirmPassword");
  });

  it("toggles both registration password fields and keeps keyboard focus on the control", async () => {
    render(<RegisterForm />);
    const fields = [screen.getByLabelText("Password"), screen.getByLabelText("Confirm password")];
    const toggles = screen.getAllByRole("button", { name: "Show text entry" });
    const user = userEvent.setup();
    fields.forEach((field) => expect(field).toHaveAttribute("type", "password"));
    for (const toggle of toggles) {
      toggle.focus();
      await user.keyboard("{Enter}");
      expect(toggle).toHaveFocus();
      expect(toggle).toHaveAccessibleName("Hide text entry");
    }
    fields.forEach((field) => expect(field).toHaveAttribute("type", "text"));
  });

  it("toggles the login password without changing its value or focus", async () => {
    const { LoginForm } = await import("@/components/auth/login-form");
    render(<LoginForm />);
    const field = screen.getByLabelText("Password");
    fireEvent.change(field, { target: { value: "my-secret" } });
    const toggle = screen.getByRole("button", { name: "Show text entry" });
    toggle.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(toggle).toHaveFocus();
    expect(field).toHaveAttribute("type", "text");
    expect(field).toHaveValue("my-secret");
  });

  it("validates the forgot-password email and displays neutral confirmation", async () => {
    render(<ForgotPasswordForm />);
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address");
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("If an account exists"));
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith("person@example.test");
  });

  it("shows a rate-limit error, allows retry, and exposes the pending state", async () => {
    let completeRequest: ((value: null) => void) | undefined;
    mocks.requestPasswordReset
      .mockRejectedValueOnce(new ApiError("Too many requests", "http", 429, "TOO_MANY_REQUESTS"))
      .mockImplementationOnce(() => new Promise((resolve) => { completeRequest = resolve; }));
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");

    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByRole("button", { name: "Please wait..." })).toBeDisabled();
    completeRequest?.(null);
    expect(await screen.findByRole("status")).toHaveTextContent("If an account exists");
  });

  it("rejects reset confirmation mismatch, then submits only token and new password", async () => {
    render(<ResetPasswordForm />);
    await screen.findByLabelText("New password");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "mismatch-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(screen.getByText("Passwords do not match.")).toHaveAttribute("id", "reset-confirm-error");
    expect(mocks.resetPassword).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledWith({ token: "opaque-test-token", password: "new-password" }));
    expect(await screen.findByText(/Your password has been updated/)).toBeInTheDocument();
  });

  it("shows a safe invalid or expired reset state with a retry path", async () => {
    mocks.resetPassword.mockRejectedValue(new ApiError("This password reset link is invalid or has expired.", "http", 400, "PASSWORD_RESET_INVALID"));
    render(<ResetPasswordForm />);
    await screen.findByLabelText("New password");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password-value" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This reset link is invalid or has expired");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeInTheDocument();
  });
});
