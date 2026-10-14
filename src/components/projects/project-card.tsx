import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";
import type { Project } from "@/lib/api/types/project";

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Card className="hover:border-foreground/30 focus-within:border-foreground/30 transition-colors">
      <CardHeader>
        <CardTitle className="text-base">
          <Link
            href={`/act/${project._id}`}
            className="focus-visible:ring-ring rounded-sm outline-none focus-visible:ring-2"
          >
            {project.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground line-clamp-3 text-sm">{project.description}</p>
        <p className="text-muted-foreground text-xs">
          Started by {project.creator.name} ·{" "}
          <time dateTime={project.createdAt}>{formatDate(project.createdAt)}</time>
        </p>
      </CardContent>
    </Card>
  );
}
