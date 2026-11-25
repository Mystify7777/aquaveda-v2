import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import AdminAccountsPage from "@/app/(protected)/admin/accounts/page";
import AdminAccountPage from "@/app/(protected)/admin/accounts/[userId]/page";
import { findBrokenLinks } from "@/test-utils/app-routes";

const directory = vi.fn();
const detail = vi.fn();
vi.mock("@/components/admin/account-directory", () => ({
  AccountDirectory: (props: unknown) => {
    directory(props);
    return <div data-testid="directory" />;
  },
}));
vi.mock("@/components/admin/account-detail", () => ({
  AccountDetail: (props: unknown) => {
    detail(props);
    return <div data-testid="detail" />;
  },
}));

describe("/admin/accounts (inside the protected route group)", () => {
  it("parses the URL with the backend's rules and hands the query to the view", async () => {
    directory.mockClear();
    render(await AdminAccountsPage({ searchParams: Promise.resolve({ role: "ADMIN", q: " ab ", page: "4" }) }));
    expect(screen.getByRole("heading", { level: 1, name: "Accounts" })).toBeInTheDocument();
    expect(directory).toHaveBeenCalledWith({ query: { filters: { role: "ADMIN", q: "ab" }, page: 4, invalid: {} } });
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("an unknown parameter is handed to the view as INVALID (the API would answer 400), not ignored", async () => {
    directory.mockClear();
    render(await AdminAccountsPage({ searchParams: Promise.resolve({ role: "ADMIN", junk: "x" }) }));
    expect(directory).toHaveBeenCalledWith({
      query: { filters: { role: "ADMIN" }, page: 1, invalid: { unknown: ["junk"] } },
    });
  });

  it("detail: id and history page", async () => {
    detail.mockClear();
    render(await AdminAccountPage({ params: Promise.resolve({ userId: "abc" }), searchParams: Promise.resolve({ page: "3" }) }));
    expect(detail).toHaveBeenCalledWith({ userId: "abc", historyPage: 3 });
    expect(screen.getByRole("link", { name: "All accounts" })).toHaveAttribute("href", "/admin/accounts");
    detail.mockClear();
    render(await AdminAccountPage({ params: Promise.resolve({ userId: "abc" }), searchParams: Promise.resolve({ page: "x" }) }));
    expect(detail).toHaveBeenCalledWith({ userId: "abc", historyPage: 1 });
  });

  it("canonical public URLs resolve (the (protected) group is not a URL segment); /protected/* does not", () => {
    expect(findBrokenLinks(["/admin/accounts", "/admin/accounts/abc123", "/admin/accounts?role=ADMIN"])).toEqual([]);
    expect(findBrokenLinks(["/protected/admin/accounts", "/(protected)/admin/accounts"]).length).toBe(2);
  });
});
