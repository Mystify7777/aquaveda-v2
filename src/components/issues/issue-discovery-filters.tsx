import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/lib/issues/classification";
import {
  exploreHref,
  hasDiscoveryFilters,
  withoutDiscoveryFilters,
  type ExploreFilters,
  type ExploreQuery,
} from "@/lib/issues/discovery";

const labelClass = "text-sm font-medium";

/**
 * Explore search + category/severity filters (#82). A plain GET form to
 * /explore: URL-driven, no client state, works without JS. Blank fields
 * submit as empty params; the page redirects those to the canonical URL.
 * `status` and the map area (`bbox`) are carried as hidden fields so
 * applying a filter does not drop them; page is never carried (resets to 1).
 * The map area has no field here; it is set from the map ("Search this area").
 */
export function IssueDiscoveryFilters({
  filters,
  invalid,
}: {
  filters: ExploreFilters;
  invalid: ExploreQuery["invalid"];
}) {
  const problems = [invalid.q, invalid.bbox].filter((p) => p !== undefined);
  const active = hasDiscoveryFilters(filters) || problems.length > 0;
  const clearHref = exploreHref(withoutDiscoveryFilters(filters));

  return (
    <section aria-label="Search and filter issues" className="space-y-3">
      {problems.length > 0 && (
        <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 space-y-2 rounded-md border p-3 text-sm">
          <p>These filters can&apos;t be applied, so no results are shown:</p>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p.problem}>{p.problem}</li>
            ))}
          </ul>
        </div>
      )}
      <form
        method="get"
        action="/explore"
        role="search"
        className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start"
      >
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        {filters.bbox && <input type="hidden" name="bbox" value={filters.bbox} />}
        <div className="space-y-1">
          <label htmlFor="explore-q" className={labelClass}>
            Search
          </label>
          <Input
            id="explore-q"
            name="q"
            type="search"
            defaultValue={invalid.q?.value ?? filters.q ?? ""}
            aria-describedby="explore-q-hint"
            aria-invalid={invalid.q ? true : undefined}
          />
          <p id="explore-q-hint" className="text-muted-foreground text-xs">
            Whole words in the title or description. Every word must match.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="explore-category" className={labelClass}>
            Category
          </label>
          <Select id="explore-category" name="category" defaultValue={filters.category ?? ""}>
            <option value="">Any category</option>
            {ISSUE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="explore-severity" className={labelClass}>
            Severity
          </label>
          <Select id="explore-severity" name="severity" defaultValue={filters.severity ?? ""}>
            <option value="">Any severity</option>
            {ISSUE_SEVERITIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
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
              <Link href={clearHref}>Clear filters</Link>
            </Button>
          )}
        </div>
      </form>
      {filters.bbox && (
        <p className="text-muted-foreground text-sm">
          Showing issues inside the selected map area.{" "}
          <Link href={exploreHref({ ...filters, bbox: undefined })} className="text-foreground underline">
            Clear map area
          </Link>
        </p>
      )}
    </section>
  );
}
