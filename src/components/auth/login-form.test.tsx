import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LoginForm } from "@/components/auth/login-form";
import { ApiError } from "@/lib/api/client";

const mockLogin = vi.fn();
const mockReplace = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ login: mockLogin }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

describe("LoginForm accessibility regression baseline", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockReplace.mockReset();
  });

  it("associates visible labels with the email and password controls", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "login-email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("id", "login-password");
  });

  it("keeps every form control keyboard reachable in DOM order", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.tab();
    expect(screen.getByLabelText("Email")).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Password")).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveFocus();
  });

  it("submits using Enter from the password field and restores an announced error", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(
      new ApiError("bad credentials", "http", 401, "INVALID_CREDENTIALS"),
    );
    render(<LoginForm />);

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    await user.type(email, "person@example.com");
    await user.type(password, "wrong-password");
    password.focus();
    await user.keyboard("{Enter}");

    expect(mockLogin).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "wrong-password",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not sign you in with those details.",
    );
    expect(password).toHaveFocus();
  });

  it("announces client-side validation failures through an alert", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter your email and password.",
    );
  });

  it("announces authentication failures through the same alert contract", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(
      new ApiError("bad credentials", "http", 401, "INVALID_CREDENTIALS"),
    );
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not sign you in with those details.",
    );
  });

  it("keeps entered values and disables the submit while a keyboard submission is pending", async () => {
    const user = userEvent.setup();
    let resolveLogin!: () => void;
    mockLogin.mockImplementation(
      () => new Promise<void>((resolve) => { resolveLogin = resolve; }),
    );
    render(<LoginForm />);

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    await user.type(email, "person@example.com");
    await user.type(password, "correct-horse");
    password.focus();
    await user.keyboard("{Enter}");

    const pendingButton = screen.getByRole("button", { name: "Please wait..." });
    expect(pendingButton).toBeDisabled();
    expect(email).toHaveValue("person@example.com");
    expect(password).toHaveValue("correct-horse");
    expect(mockLogin).toHaveBeenCalledTimes(1);

    resolveLogin();
    await screen.findByRole("button", { name: "Sign in" });
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});
