import type { Metadata } from "next";

import { ReportIssueButton } from "@/components/issues/report-issue-button";

export const metadata: Metadata = { title: "Explore" };

/**
 * Deliberately minimal mount point (#44). Map/list/detail belong to #50
 * and replace the body of this page; the public, anonymous-accessible
 * route contract is what this establishes.
 */
export default function ExplorePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Explore</h1>
        <ReportIssueButton />
      </div>
    </div>
  );
}
