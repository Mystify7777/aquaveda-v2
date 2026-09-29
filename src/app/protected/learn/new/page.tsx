import type { Metadata } from "next";

import { KnowledgeDraftForm } from "@/components/knowledge/knowledge-draft-form";

export const metadata: Metadata = { title: "New knowledge draft" };

/**
 * Knowledge draft authoring (#45). Authentication is enforced by the
 * (protected) route-group layout, not here. Learn list/detail are F3.
 */
export default function NewKnowledgeDraftPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16 sm:px-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">New knowledge draft</h1>
        <p className="text-muted-foreground text-sm">
          Write an article draft. It will be saved with draft status.
        </p>
      </div>
      <KnowledgeDraftForm />
    </div>
  );
}
