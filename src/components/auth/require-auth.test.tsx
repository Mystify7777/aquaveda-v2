import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { RequireAuth } from "@/components/auth/require-auth";
import type { AuthStatus } from "@/components/providers/auth-provider";

/**
 * useAuth is mocked directly rather than wrapping with a real
 * AuthProvider — RequireAuth is a pure function of `status`, and the
 * logic that actually computes that status (initializeAuthSession,
 * including the network-vs-session-failure distinction) already has
 * its own dedicated coverage in src/lib/auth-state.test.js. This file
 * verifies only "given each of the 5 possible statuses, does
 * RequireAuth render the correct thing" — driving state through a
 * real AuthProvider (with mocked API calls) would re-test
 * auth-state.js's logic a second time without adding coverage of
 * anything RequireAuth itself is responsible for.
 */
const mockUseAuth = vi.fn();

vi.mock("@/components/providers/auth-provider", () => ({
    useAuth: () => mockUseAuth(),
}));

/**
 * Typed against the real, exported AuthStatus — not a bare `string` —
 * so this helper can't be called with a value that isn't one of the 5
 * canonical states. An authentication-boundary test shouldn't throw
 * away the type system it's testing against.
 */
function setStatus(status: AuthStatus) {
    mockUseAuth.mockReturnValue({ status, user: null, login: vi.fn(), register: vi.fn(), logout: vi.fn() });
}

describe("RequireAuth", () => {
    beforeEach(() => {
        mockUseAuth.mockReset();
    });

    it("initializing: renders a busy indicator, not the protected content", () => {
        setStatus("initializing");
        render(
            <RequireAuth>
                <div>Protected content</div>
            </RequireAuth>,
        );
        expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
        expect(screen.getByLabelText("Checking authentication")).toHaveAttribute("aria-busy", "true");
    });

    it("authenticated: renders the protected children", () => {
        setStatus("authenticated");
        render(
            <RequireAuth>
                <div>Protected content</div>
            </RequireAuth>,
        );
        expect(screen.getByText("Protected content")).toBeInTheDocument();
    });

    it("anonymous: renders a sign-in/register prompt, not the protected content", () => {
        setStatus("anonymous");
        render(
            <RequireAuth>
                <div>Protected content</div>
            </RequireAuth>,
        );
        expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
        expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
    });

    it("session-failure: renders a distinct 'sign in again' message, not the generic unavailable message", () => {
        setStatus("session-failure");
        render(
            <RequireAuth>
                <div>Protected content</div>
            </RequireAuth>,
        );
        expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toMatch(/problem with your session/i);
        expect(alert.textContent).not.toMatch(/unavailable/i);
        // session-failure offers a way to recover (sign in again) —
        // unavailable deliberately does not (see the next test).
        expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    });

    it("unavailable: renders a distinct network/backend message, never implying the session itself is the problem", () => {
        setStatus("unavailable");
        render(
            <RequireAuth>
                <div>Protected content</div>
            </RequireAuth>,
        );
        expect(screen.queryByText("Protected content")).not.toBeInTheDocument();
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toMatch(/unavailable/i);
        expect(alert.textContent).not.toMatch(/session/i);
        // No "sign in again" action here — the account/session state
        // is genuinely unknown, not implicated.
        expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    });

    it("session-failure and unavailable render distinguishably different text (regression against collapsing them)", () => {
        setStatus("session-failure");
        const { unmount } = render(
            <RequireAuth>
                <div />
            </RequireAuth>,
        );
        const sessionFailureText = screen.getByRole("alert").textContent;
        unmount();

        setStatus("unavailable");
        render(
            <RequireAuth>
                <div />
            </RequireAuth>,
        );
        const unavailableText = screen.getByRole("alert").textContent;

        expect(sessionFailureText).not.toBe(unavailableText);
    });
});
