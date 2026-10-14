import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Project not found</h1>
      <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
        This project doesn&apos;t exist or the link is incorrect.
      </p>
      <Button asChild>
        <Link href="/act">Back to projects</Link>
      </Button>
    </div>
  );
}
