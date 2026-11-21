import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RequireAuth } from "@/components/auth/require-auth";
import type { AuthStatus } from "@/components/providers/auth-provider";

const retryInitialization = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({
    useAuth: () => mockUseAuth(),
}));

function setStatus(status: AuthStatus) {
    mockUseAuth.mockReturnValue({
        status,
        user: null,
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        retryInitialization,
    });
}

describe("RequireAuth", () => {
    beforeEach(() => {
        mockUseAuth.mockReset();
        retryInitialization.mockReset();
    });

    it("initializing: renders a busy indicator, not the protected content", () => {
        setStatus("initializing");
        render(<RequireAuth><div>Protected content</div></RequireAuth>);
        expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveAccessibleName("Checking authentication");
    });

    it("authenticated: renders the protected children", () => {
        setStatus("authenticated");
        render(<RequireAuth><div>Protected content</div></RequireAuth>);
        expect(screen.getByText("Protected content")).toBeInTheDocument();
    });

    it("anonymous: renders a sign-in/register prompt", () => {
        setStatus("anonymous");
        render(<RequireAuth><div>Protected content</div></RequireAuth>);
        expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
        expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/auth/register");
    });

    it("session-failure: offers sign-in again, not the network retry", () => {
        setStatus("session-failure");
        render(<RequireAuth><div>Protected content</div></RequireAuth>);
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent(/problem with your session/i);
        expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login");
        expect(screen.queryByRole("button", { name: "Retry connection" })).not.toBeInTheDocument();
        expect(retryInitialization).not.toHaveBeenCalled();
    });

    it("unavailable: explains unknown session state and exposes manual recovery", async () => {
        const user = userEvent.setup();
        setStatus("unavailable");
        render(<RequireAuth><div>Protected content</div></RequireAuth>);

        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent(/session has not been cleared/i);
        expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Retry connection" }));
        expect(retryInitialization).toHaveBeenCalledTimes(1);
    });

    it("session-failure and unavailable remain distinct states", () => {
        setStatus("session-failure");
        const first = render(<RequireAuth><div /></RequireAuth>);
        const sessionFailure = screen.getByRole("alert").textContent;
        first.unmount();

        setStatus("unavailable");
        render(<RequireAuth><div /></RequireAuth>);
        const unavailable = screen.getByRole("alert").textContent;

        expect(sessionFailure).not.toBe(unavailable);
    });
});
