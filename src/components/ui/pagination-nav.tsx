import Link from "next/link";

import { Button } from "@/components/ui/button";

/** URL-driven prev/next as real links (works without JS). Page 1 links to the bare basePath. */
export function PaginationNav({
  page,
  totalPages,
  basePath,
  label,
  params,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  label: string;
  /** Extra query params (e.g. an active filter) preserved on every link. */
  params?: Record<string, string>;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const search = new URLSearchParams(params);
    if (p !== 1) search.set("page", String(p));
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <nav aria-label={label} className="flex items-center justify-between gap-4">
      {page > 1 ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page - 1)} rel="prev">
            Previous
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground text-sm" aria-current="page">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page + 1)} rel="next">
            Next
          </Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}
