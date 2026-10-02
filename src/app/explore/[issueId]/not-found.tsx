import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function IssueNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Issue not found</h1>
      <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
        This issue doesn&apos;t exist or the link is incorrect.
      </p>
      <Button asChild>
        <Link href="/explore">Back to Explore</Link>
      </Button>
    </div>
  );
}
