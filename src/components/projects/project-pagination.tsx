import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Prev/next as real links (URL-driven, works without JS). */
export function ProjectPagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const href = (p: number) => (p === 1 ? "/act" : `/act?page=${p}`);

  return (
    <nav aria-label="Project pages" className="flex items-center justify-between gap-4">
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
