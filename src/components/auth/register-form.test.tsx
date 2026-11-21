import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RegisterForm } from "@/components/auth/register-form";

const mockRegister = vi.fn();
const mockReplace = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ register: mockRegister }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

describe("RegisterForm accessibility regression baseline", () => {
  beforeEach(() => {
    mockRegister.mockReset();
    mockReplace.mockReset();
  });

  it("associates all visible labels with their controls", () => {
    render(<RegisterForm />);

    expect(screen.getByLabelText("Name")).toHaveAttribute("id", "register-name");
    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "register-email");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute("id", "register-password");
    expect(screen.getByLabelText("Confirm password", { exact: true })).toHaveAttribute("id", "register-confirm-password");
  });

  it("keeps all controls keyboard reachable in DOM order", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.tab();
    expect(screen.getByLabelText("Name")).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Email")).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Password", { exact: true })).toHaveFocus();

    await user.tab();
    expect(screen.getAllByRole("button", { name: "Show text entry" })[0]).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Confirm password", { exact: true })).toHaveFocus();

    await user.tab();
    expect(screen.getAllByRole("button", { name: "Show text entry" })[1]).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Create account" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveFocus();
  });

  it("announces required-field validation through an alert", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter your name, email, password, and password confirmation.",
    );
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("announces invalid email and password length conditions", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText("Name"), "Asha");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password", { exact: true }), "short");
    await user.type(screen.getByLabelText("Confirm password", { exact: true }), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid email address.",
    );
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
