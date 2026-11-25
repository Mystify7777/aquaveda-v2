import type { Metadata } from "next";

import { AccountDirectory } from "@/components/admin/account-directory";
import { parseDirectoryQuery } from "@/lib/accounts/directory";

export const metadata: Metadata = { title: "Accounts" };

/**
 * ADMIN account directory (#250, read-only; API #181). Filters and page are URL
 * state parsed here with the backend's own query rules. Who may read it is the
 * backend's decision (ADMIN only); the client view also withholds the request
 * from signed-in non-ADMINs.
 */
export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseDirectoryQuery(await searchParams);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Accounts</h1>
      <p className="text-muted-foreground max-w-prose text-sm">
        Browse and search accounts and their governance history. This view is read-only: it does not change any
        account.
      </p>
      <AccountDirectory query={query} />
    </div>
  );
}
