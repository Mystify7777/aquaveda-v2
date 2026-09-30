import type { Metadata } from "next";

import { ProjectCreateForm } from "@/components/projects/project-create-form";

export const metadata: Metadata = { title: "New project" };

/**
 * Project creation (#47). Authentication is enforced by the protected
 * layout, not here. Act list/detail are #52, which relocates this form.
 */
export default function NewProjectPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">New project</h1>
        <p className="text-muted-foreground text-sm">
          Start a project from an existing issue.
        </p>
      </div>
      <ProjectCreateForm />
    </div>
  );
}
