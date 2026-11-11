import Link from "next/link";

import { Button } from "@/components/ui/button";

export function WakeUpState() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-72 flex-col justify-between p-5"
    >
      <div className="space-y-3">
        <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          Taking a little longer
        </p>
        <p className="font-display text-base font-semibold">
          The service is taking a little longer to start.
        </p>
        <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
          The application is still working. You can keep browsing this page
          while the public issue data becomes available.
        </p>
      </div>

      <div>
        <Button asChild size="sm" variant="outline">
          <Link href="/explore">Open the public issue view</Link>
        </Button>
      </div>
    </div>
  );
}
