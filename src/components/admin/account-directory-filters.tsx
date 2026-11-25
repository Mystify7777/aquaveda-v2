import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  ADMIN_ACCOUNTS_HREF,
  directoryProblems,
  hasDirectoryFilters,
  hasInvalidDirectoryQuery,
  type DirectoryFilters,
  type DirectoryQuery,
} from "@/lib/accounts/directory";
import { DIRECTORY_ROLES, DIRECTORY_STATES, SEARCH_MIN_LENGTH } from "@/lib/accounts/directory-contract";
import { roleLabel, stateLabel } from "@/lib/accounts/presentation";

const labelClass = "text-sm font-medium";

/**
 * Directory search + filters: a plain GET form to the directory URL. URL-driven,
 * no client state, works without JS. Applying a filter never carries `page`
 * (the result set changes, so it restarts at page 1).
 */
export function AccountDirectoryFilters({
  filters,
  invalid,
}: {
  filters: DirectoryFilters;
  invalid: DirectoryQuery["invalid"];
}) {
  const problems = directoryProblems(invalid);
  const active = hasDirectoryFilters(filters) || hasInvalidDirectoryQuery(invalid);
  return (
    <section aria-label="Search and filter accounts" className="space-y-3">
      {problems.length > 0 && (
        <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 space-y-1 rounded-md border p-3 text-sm">
          <p>This link can&apos;t be applied as written, so no results are shown:</p>
          <ul className="list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p>Fix or clear the filters to continue.</p>
        </div>
      )}
      <form
        method="get"
        action={ADMIN_ACCOUNTS_HREF}
        role="search"
        className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start"
      >
        <div className="space-y-1">
          <label htmlFor="accounts-q" className={labelClass}>
            Search
          </label>
          <Input
            id="accounts-q"
            name="q"
            type="search"
            defaultValue={invalid.q?.value ?? filters.q ?? ""}
            aria-describedby="accounts-q-hint"
            aria-invalid={invalid.q ? true : undefined}
          />
          <p id="accounts-q-hint" className="text-muted-foreground text-xs">
            Starts-with match on name or email, or an exact account id. At least {SEARCH_MIN_LENGTH} characters.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="accounts-role" className={labelClass}>
            Role
          </label>
          <Select id="accounts-role" name="role" defaultValue={filters.role ?? ""}>
            <option value="">Any role</option>
            {DIRECTORY_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="accounts-state" className={labelClass}>
            Account state
          </label>
          <Select id="accounts-state" name="accountState" defaultValue={filters.accountState ?? ""}>
            <option value="">Any state</option>
            {DIRECTORY_STATES.map((s) => (
              <option key={s} value={s}>
                {stateLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2 sm:col-span-3 lg:col-span-1 lg:mt-6">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          {active && (
            <Button asChild size="sm" variant="ghost">
              <Link href={ADMIN_ACCOUNTS_HREF}>Clear filters</Link>
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
