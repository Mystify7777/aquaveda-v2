import type { Metadata } from "next";
import Link from "next/link";

import { AccountDetail } from "@/components/admin/account-detail";
import { ADMIN_ACCOUNTS_HREF, parsePage } from "@/lib/accounts/directory";

export const metadata: Metadata = { title: "Account" };

/** ADMIN account detail and governance history (#250, read-only). `?page=` pages the history. */
export default async function AdminAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const [{ userId }, { page }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-16 sm:px-6">
      <nav aria-label="Breadcrumb">
        <Link href={ADMIN_ACCOUNTS_HREF} className="text-muted-foreground text-sm underline-offset-4 hover:underline">
          All accounts
        </Link>
      </nav>
      <h1 className="font-display text-3xl font-semibold tracking-tight">Account</h1>
      <AccountDetail userId={userId} historyPage={parsePage(page)} />
    </div>
  );
}
