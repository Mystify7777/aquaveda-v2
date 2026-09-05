import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-16 sm:px-6 sm:py-24">
      <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
        404
      </p>
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
        The page you&apos;re looking for doesn&apos;t exist or may have been
        moved.
      </p>
      <Button asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}
