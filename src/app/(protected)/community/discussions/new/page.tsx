"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { createDiscussion } from "@/lib/api/discussions";
import type { DiscussionCategory } from "@/lib/api/types/discussion";
import { ApiError } from "@/lib/api/client";

const CATEGORIES: Array<{ value: DiscussionCategory; label: string }> = [
  { value: "QUESTION", label: "Question" },
  { value: "DISCUSSION", label: "Discussion" },
  { value: "IDEA", label: "Idea" },
];

export default function NewDiscussionPage() {
  const router = useRouter();
  const titleId = React.useId();
  const bodyId = React.useId();
  const categoryId = React.useId();
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [category, setCategory] = React.useState<DiscussionCategory>("QUESTION");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  // Ref guard: pending state updates after the event, so two rapid submit
  // events must not both reach the API before the first render settles.
  const inFlight = React.useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) { setError("Title and body are required."); return; }
    setError(null);
    inFlight.current = true;
    setPending(true);
    try {
      const discussion = await createDiscussion({ title: trimmedTitle, body: trimmedBody, category });
      router.push("/community/discussions/" + encodeURIComponent(discussion._id));
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) setError("Your session is no longer valid. Sign in again to create a discussion.");
        else if (error.status === 403) setError("Your account is not permitted to create discussions.");
        else if (error.code === "VALIDATION_FAILED") setError(error.message);
        else if (error.kind === "network") setError("The service is unreachable right now. Check your connection and try again.");
        else setError("We could not publish the discussion. Try again.");
      } else setError("We could not publish the discussion. Try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">Community</p>
          <CardTitle className="text-2xl">Start a discussion</CardTitle>
          <p className="text-muted-foreground text-sm">Ask a question, open a conversation, or share an idea. Keep it useful and specific.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {error && <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">{error}</div>}
            <div className="space-y-1.5">
              <label htmlFor={titleId} className="text-sm font-medium">Title</label>
              <input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required autoFocus className="border-input bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={categoryId} className="text-sm font-medium">Category</label>
              <select id={categoryId} value={category} onChange={(event) => setCategory(event.target.value as DiscussionCategory)} className="border-input bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2">
                {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={bodyId} className="text-sm font-medium">Body</label>
              <Textarea id={bodyId} value={body} onChange={(event) => setBody(event.target.value)} rows={10} required />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => router.push("/community")}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Publishing..." : "Publish discussion"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}