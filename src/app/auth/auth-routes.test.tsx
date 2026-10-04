import fs from "node:fs";
import path from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import LoginPage from "@/app/auth/login/page";
import RegisterPage from "@/app/auth/register/page";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { RequireAuth } from "@/components/auth/require-auth";
import { AuthControls } from "@/components/layout/auth-controls";

/**
 * Issue #80 — the public auth page URLs.
 *
 * Canonical: /auth/login and /auth/register (the pages live at
 * src/app/auth/{login,register}/page.tsx). The frontend page URLs are
 * unrelated to the backend API (/api/v1/auth/*).
 *
 * The bug class: a component links to a path no App Router page serves
 * (/login, /register), and an href-string assertion alone cannot notice.
 * These tests therefore map each rendered href to the page file that
 * serves it. `routeHasPage` only understands static paths (no dynamic
 * segments or route groups) — enough for the auth pages; the wider route
 * and link audit is Issue #81.
 */

const mockUseAuth = vi.fn();
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

/** True iff `href` (path only) is served by a static page.tsx under src/app. */
function routeHasPage(href: string): boolean {
  const pathname = href.split(/[?#]/)[0];
  if (!pathname.startsWith("/")) return false;
  const segments = pathname.split("/").filter(Boolean);
  return fs.existsSync(path.join(process.cwd(), "src", "app", ...segments, "page.tsx"));
}

const CANONICAL = { login: "/auth/login", register: "/auth/register" } as const;

const anonymous = () => ({
  status: "anonymous",
  user: null,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
});

/** Every in-app link (href starting with "/") inside a rendered tree. */
const internalHrefs = (container: HTMLElement) =>
  [...container.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href")!)
    .filter((h) => h.startsWith("/"));

describe("route-existence helper (negative control)", () => {
  it("accepts the real auth pages and rejects the paths that used to be linked", () => {
    expect(routeHasPage(CANONICAL.login)).toBe(true);
    expect(routeHasPage(CANONICAL.register)).toBe(true);
    expect(routeHasPage("/auth/login?next=/explore")).toBe(true);
    // The pre-#80 bug: these served 404s.
    expect(routeHasPage("/login")).toBe(false);
    expect(routeHasPage("/register")).toBe(false);
    expect(routeHasPage("/auth/missing")).toBe(false);
    expect(routeHasPage("login")).toBe(false);
  });
});

describe("canonical auth URLs resolve to the real pages", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(anonymous());
  });

  it("/auth/login is served by the login page", () => {
    expect(routeHasPage(CANONICAL.login)).toBe(true);
    render(<LoginPage />);
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("/auth/register is served by the register page", () => {
    expect(routeHasPage(CANONICAL.register)).toBe(true);
    render(<RegisterPage />);
    expect(screen.getByText("Create your account")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });
});

describe("every auth link in shared UI uses the canonical URL and resolves to a page", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue(anonymous());
  });

  it("LoginForm links to registration", () => {
    const { container } = render(<LoginForm />);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", CANONICAL.register);
    for (const href of internalHrefs(container)) expect(routeHasPage(href), href).toBe(true);
  });

  it("RegisterForm links to sign-in", () => {
    const { container } = render(<RegisterForm />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", CANONICAL.login);
    for (const href of internalHrefs(container)) expect(routeHasPage(href), href).toBe(true);
  });

  it.each([[false], [true]])("AuthControls (anonymous, mobile=%s) links to sign-in and register", (mobile) => {
    const { container } = render(<AuthControls mobile={mobile} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", CANONICAL.login);
    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", CANONICAL.register);
    const hrefs = internalHrefs(container);
    expect(hrefs.sort()).toEqual([CANONICAL.login, CANONICAL.register]);
    for (const href of hrefs) expect(routeHasPage(href), href).toBe(true);
  });

  it("RequireAuth's anonymous prompt links resolve to pages", () => {
    const { container } = render(
      <RequireAuth>
        <p>protected</p>
      </RequireAuth>,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", CANONICAL.login);
    expect(screen.getByRole("link", { name: "Register" })).toHaveAttribute("href", CANONICAL.register);
    for (const href of internalHrefs(container)) expect(routeHasPage(href), href).toBe(true);
  });

  it("the login and register pages link to each other at URLs that exist", () => {
    const login = render(<LoginPage />);
    const toRegister = internalHrefs(login.container);
    login.unmount();
    const register = render(<RegisterPage />);
    const toLogin = internalHrefs(register.container);
    expect(toRegister).toEqual([CANONICAL.register]);
    expect(toLogin).toEqual([CANONICAL.login]);
    for (const href of [...toRegister, ...toLogin]) expect(routeHasPage(href), href).toBe(true);
  });
});
