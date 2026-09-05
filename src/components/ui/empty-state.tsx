import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description: string;
  action?: React.ReactNode;
}

function EmptyState({
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 px-4 py-12 text-center",
        className,
      )}
      {...props}
    >
      <h2 className="font-display text-lg font-semibold">{title}</h2>

      <p className="text-muted-foreground max-w-md text-sm leading-relaxed">
        {description}
      </p>

      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export { EmptyState };

