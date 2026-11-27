"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { AccountGovernanceActions } from "@/components/admin/account-governance-actions";
import { AccountStateBadge } from "@/components/admin/account-state-badge";
import { GovernanceHistory } from "@/components/admin/governance-history";
import { RequireAdmin } from "@/components/admin/require-admin";
import { useAuth } from "@/components/providers/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError, loadErrorMessage } from "@/components/ui/load-error";
import { PaginationNav } from "@/components/ui/pagination-nav";
import { Skeleton } from "@/components/ui/skeleton";
import { ADMIN_ACCOUNTS_HREF, accountDetailHref } from "@/lib/accounts/directory";
import type { GovernanceFailure } from "@/lib/accounts/governance-actions";
import { deletionSummary, restrictionSummary, roleLabel } from "@/lib/accounts/presentation";
import { getAccountEntry, getAccountHistory } from "@/lib/api/accounts";
import type { AdminAccountEntry, AdminHistoryPage } from "@/lib/api/types/accounts";
import { useApiResource, type ApiResource } from "@/lib/api/use-api-resource";
import { formatDateTime } from "@/lib/format-date";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

function EntryCard({ entry, isSelf, children }: { entry: AdminAccountEntry; isSelf: boolean; children?: React.ReactNode }) {
  const restriction = restrictionSummary(entry.restriction);
  const deletion = deletionSummary(entry);
  const operatorManaged = entry.role === "ADMIN" || isSelf;
  return (
    <section aria-label="Account" className="border-border space-y-4 rounded-xl border p-5">
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold">{entry.name}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <AccountStateBadge state={entry.accountState} />
          {entry.restriction?.lapsed && <Badge variant="outline">Restriction lapsed</Badge>}
          {entry.deletionPending && <Badge variant="warning">Deletion pending</Badge>}
        </div>
      </header>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Email">{entry.email}</Field>
        <Field label="Role">{roleLabel(entry.role)}</Field>
        <Field label="Registered">{formatDateTime(entry.registeredAt)}</Field>
        <Field label="Account id">
          <code className="text-xs">{entry.id}</code>
        </Field>
        {entry.accountStateChangedAt && (
          <Field label="State last changed">{formatDateTime(entry.accountStateChangedAt)}</Field>
        )}
        {restriction && <Field label="Restriction">{restriction}</Field>}
        {entry.restriction?.safeReason && <Field label="Reason shown to the user">{entry.restriction.safeReason}</Field>}
        {deletion && <Field label="Deletion">{deletion}</Field>}
      </dl>
      {operatorManaged && (
        <p className="text-muted-foreground border-border border-t pt-3 text-sm">
          Administrator accounts are managed by operators and cannot be restricted from here.
        </p>
      )}
      {children}
    </section>
  );
}

function HistorySection({
  userId,
  page,
  resource,
  reload,
  refreshing,
}: {
  userId: string;
  page: number;
  resource: ApiResource<AdminHistoryPage>;
  reload: () => void;
  refreshing: boolean;
}) {
  const basePath = `${ADMIN_ACCOUNTS_HREF}/${encodeURIComponent(userId)}`;

  return (
    <section aria-label="Governance history section" aria-busy={refreshing} className="space-y-3">
      <h2 className="font-display text-lg font-semibold">Governance history</h2>
      {resource.status === "loading" && (
        <div role="status" className="space-y-2">
          <span className="sr-only">Loading governance history...</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {resource.status === "error" && (
        <LoadError
          message={loadErrorMessage(resource.error, "governance history")}
          onRetry={reload}
          signIn={resource.error.status === 401}
          error={resource.error}
        />
      )}
      {resource.status === "success" &&
        (resource.data.items.length === 0 ? (
          <EmptyState
            title={resource.data.total > 0 ? "No events on this page" : "No governance history"}
            description={
              resource.data.total > 0
                ? "This page is past the last page of history."
                : "No governance action has been recorded for this account."
            }
          />
        ) : (
          <>
            <GovernanceHistory events={resource.data.items} />
            <PaginationNav page={page} totalPages={resource.data.totalPages} basePath={basePath} label="History pages" />
          </>
        ))}
    </section>
  );
}

function Detail({ userId, historyPage }: { userId: string; historyPage: number }) {
  const { user } = useAuth();
  const router = useRouter();
  const entry = useApiResource((signal) => getAccountEntry(userId, { signal }), `account:${userId}`);
  const history = useApiResource(
    (signal) => getAccountHistory(userId, { page: historyPage }, { signal }),
    `account-history:${userId}:${historyPage}`,
  );
  const [notice, setNotice] = React.useState<{ tone: "success" | "warning"; message: string } | null>(null);

  /**
   * Converge with the server after a governance outcome: re-read the account and its
   * history IN PLACE (data stays on screen). A new event sorts first, so a deeper
   * history page moves to page 1. Never re-sends a mutation.
   */
  const reconcile = () => {
    entry.refresh();
    history.refresh();
    if (historyPage > 1) router.replace(accountDetailHref(userId));
  };
  const refreshing = entry.refreshing || history.refreshing;
  const refreshFailed = entry.refreshError !== null || history.refreshError !== null;

  if (entry.resource.status === "loading") {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading account...</span>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (entry.resource.status === "error") {
    const { status } = entry.resource.error;
    if (status === 404 || status === 400) {
      return (
        <EmptyState
          title="Account not found"
          description="This account does not exist or the link is not valid."
          action={
            <Link href={ADMIN_ACCOUNTS_HREF} className="underline">
              Back to accounts
            </Link>
          }
        />
      );
    }
    return (
      <LoadError
        message={loadErrorMessage(entry.resource.error, "this account")}
        onRetry={entry.reload}
        signIn={status === 401}
        error={entry.resource.error}
      />
    );
  }
  const account = entry.resource.data;
  return (
    <div className="space-y-8">
      {notice && (
        <div
          role={notice.tone === "success" ? "status" : "alert"}
          className={
            notice.tone === "success"
              ? "border-border bg-muted/40 rounded-md border p-3 text-sm"
              : "border-warning/40 bg-warning/5 rounded-md border p-3 text-sm"
          }
        >
          {notice.message}
        </div>
      )}
      {refreshFailed && (
        <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <span>We couldn&apos;t refresh this account, so what is shown may be out of date.</span>
          <Button size="sm" variant="outline" onClick={reconcile}>
            Try again
          </Button>
        </div>
      )}
      <div aria-busy={refreshing}>
        <EntryCard entry={account} isSelf={user?.id === account.id}>
          <AccountGovernanceActions
            entry={account}
            viewerId={user?.id}
            busy={refreshing}
            onOpen={() => setNotice(null)}
            onApplied={(message) => {
              setNotice({ tone: "success", message });
              reconcile();
            }}
            onReconcile={(failure: GovernanceFailure) => {
              setNotice({ tone: "warning", message: failure.message });
              reconcile();
            }}
          />
        </EntryCard>
      </div>
      <HistorySection
        userId={userId}
        page={historyPage}
        resource={history.resource}
        reload={history.reload}
        refreshing={history.refreshing}
      />
    </div>
  );
}

/** Account detail + governance history (#250) with Admin governance controls for USER/EXPERT targets (#264). */
export function AccountDetail({ userId, historyPage }: { userId: string; historyPage: number }) {
  return (
    <RequireAdmin>
      <Detail userId={userId} historyPage={historyPage} />
    </RequireAdmin>
  );
}
