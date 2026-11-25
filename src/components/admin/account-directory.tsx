"use client";

import Link from "next/link";

import { AccountDirectoryFilters } from "@/components/admin/account-directory-filters";
import { AccountStateBadge } from "@/components/admin/account-state-badge";
import { RequireAdmin } from "@/components/admin/require-admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Skeleton } from "@/components/ui/skeleton";
import {
  accountDetailHref,
  directoryHref,
  directorySearchParams,
  hasDirectoryFilters,
  hasInvalidDirectoryQuery,
  toApiQuery,
  type DirectoryQuery,
} from "@/lib/accounts/directory";
import { deletionSummary, restrictionSummary, roleLabel } from "@/lib/accounts/presentation";
import { getAccountDirectory } from "@/lib/api/accounts";
import type { AdminAccountEntry } from "@/lib/api/types/accounts";
import { useApiResource } from "@/lib/api/use-api-resource";
import { formatDate } from "@/lib/format-date";

function AccountRow({ entry }: { entry: AdminAccountEntry }) {
  const restriction = restrictionSummary(entry.restriction);
  const deletion = deletionSummary(entry);
  return (
    <tr className="border-border border-t align-top">
      <th scope="row" className="px-3 py-3 text-left font-normal">
        <Link href={accountDetailHref(entry.id)} className="font-medium underline-offset-4 hover:underline">
          {entry.name}
        </Link>
        <span className="text-muted-foreground block text-xs break-all">{entry.email}</span>
      </th>
      <td className="px-3 py-3 text-sm">{roleLabel(entry.role)}</td>
      <td className="space-y-1 px-3 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <AccountStateBadge state={entry.accountState} />
          {entry.restriction?.lapsed && <Badge variant="outline">Lapsed</Badge>}
        </div>
        {restriction && <p className="text-muted-foreground text-xs">{restriction}</p>}
        {deletion && <p className="text-muted-foreground text-xs">{deletion}</p>}
      </td>
      <td className="text-muted-foreground px-3 py-3 text-sm whitespace-nowrap">{formatDate(entry.registeredAt)}</td>
    </tr>
  );
}

function DirectoryResults({ query }: { query: DirectoryQuery }) {
  const { filters, page } = query;
  const key = `accounts:${filters.role ?? ""}:${filters.accountState ?? ""}:${filters.q ?? ""}:${page}`;
  const { resource, reload } = useApiResource((signal) => getAccountDirectory(toApiQuery(query), { signal }), key);

  if (resource.status === "loading") {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading accounts...</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (resource.status === "error") {
    return (
      <LoadError
        message={loadErrorMessage(resource.error, "accounts")}
        onRetry={reload}
        signIn={resource.error.status === 401}
        error={resource.error}
      />
    );
  }

  const { items, total, totalPages } = resource.data;
  if (items.length === 0) {
    if (total > 0) {
      return (
        <EmptyState
          title="No accounts on this page"
          description="This page is past the last page of results."
          action={
            <Button asChild variant="outline">
              <Link href={directoryHref(filters)}>Back to first page</Link>
            </Button>
          }
        />
      );
    }
    return hasDirectoryFilters(filters) ? (
      <EmptyState title="No accounts match" description="No account matches these filters. Adjust or clear them to see more." />
    ) : (
      <EmptyState title="No accounts yet" description="Registered accounts will appear here." />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm" role="status">
        {total} {total === 1 ? "account" : "accounts"}
      </p>
      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[40rem] text-left">
          <caption className="sr-only">Accounts, newest registration first</caption>
          <thead className="bg-muted/40 text-muted-foreground text-xs">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Account
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Role
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                State
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Registered
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <AccountRow key={entry.id} entry={entry} />
            ))}
          </tbody>
        </table>
      </div>
      <PaginationNav
        page={page}
        totalPages={totalPages}
        basePath="/admin/accounts"
        label="Accounts pages"
        params={Object.fromEntries(directorySearchParams(filters))}
      />
    </div>
  );
}

/**
 * Read-only Admin account directory (#250). Filters and page are URL state parsed
 * on the server page. Anything the API would reject (unknown/repeated parameter,
 * bad role/state/q/page) is shown and never sent. Admin gate is UX
 * only; the backend is the authority.
 */
export function AccountDirectory({ query }: { query: DirectoryQuery }) {
  return (
    <RequireAdmin>
      <div className="space-y-6">
        <AccountDirectoryFilters filters={query.filters} invalid={query.invalid} />
        {hasInvalidDirectoryQuery(query.invalid) ? null : <DirectoryResults query={query} />}
      </div>
    </RequireAdmin>
  );
}
