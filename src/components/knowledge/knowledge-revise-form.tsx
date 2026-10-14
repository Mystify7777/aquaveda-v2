"use client";

import * as React from "react";
import Link from "next/link";

import { KnowledgeFormField as Field } from "@/components/knowledge/knowledge-form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { reviseKnowledge } from "@/lib/api/knowledge";
import type { KnowledgeLifecycleResult } from "@/lib/api/types/knowledge";
import { toActionFailure, type ActionFailure } from "@/lib/knowledge/action-failure";
import {
  validateKnowledgeDraft,
  type KnowledgeDraftErrors,
  type KnowledgeDraftField,
  type KnowledgeDraftValues,
} from "@/lib/knowledge/draft-validation";

const FIELD_ORDER: KnowledgeDraftField[] = ["title", "body"];

/**
 * rejected -> draft (POST /knowledge/:id/revise), prefilled with the
 * rejected content. Same title/body validation as draft authoring (#45);
 * afterwards the article is a draft again and the caller re-submits it
 * through the normal submit action.
 */
export function KnowledgeReviseForm({
  knowledgeId,
  initial,
  onRevised,
}: {
  knowledgeId: string;
  initial: KnowledgeDraftValues;
  onRevised: (result: KnowledgeLifecycleResult) => void;
}) {
  const [values, setValues] = React.useState<KnowledgeDraftValues>(initial);
  const [fieldErrors, setFieldErrors] = React.useState<KnowledgeDraftErrors>({});
  const [failure, setFailure] = React.useState<ActionFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  const inFlight = React.useRef(false);
  const fieldRefs = React.useRef<Partial<Record<KnowledgeDraftField, HTMLElement | null>>>({});

  function setField(field: KnowledgeDraftField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    setFailure(null);
    const result = validateKnowledgeDraft(values);
    if (!result.ok) {
      setFieldErrors(result.errors);
      const first = FIELD_ORDER.find((f) => result.errors[f]);
      if (first) fieldRefs.current[first]?.focus();
      return;
    }
    setFieldErrors({});

    inFlight.current = true;
    setPending(true);
    try {
      onRevised(await reviseKnowledge(knowledgeId, result.payload));
    } catch (error) {
      setFailure(toActionFailure(error, "revise"));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="revise-heading" className="space-y-3 border-t pt-4">
      <h2 id="revise-heading" className="font-display text-lg font-semibold">
        Revise this article
      </h2>
      <p className="text-muted-foreground text-sm">
        Saving your changes returns the article to draft, so you can submit it for review again.
      </p>
      <form onSubmit={handleSubmit} noValidate aria-busy={pending} className="space-y-4">
        {failure && (
          <div
            role="alert"
            className="text-destructive border-destructive/30 bg-destructive/5 space-y-2 rounded-md border p-3 text-sm"
          >
            <p>{failure.message}</p>
            {failure.kind === "session" && (
              <Button asChild size="sm" variant="outline">
                <Link href="/auth/login">Sign in</Link>
              </Button>
            )}
          </div>
        )}
        <fieldset disabled={pending} className="space-y-4">
          <Field id="revise-title" label="Title" error={fieldErrors.title}>
            <Input
              id="revise-title"
              ref={(el) => {
                fieldRefs.current.title = el;
              }}
              value={values.title}
              onChange={(e) => setField("title", e.target.value)}
              aria-invalid={!!fieldErrors.title}
              aria-describedby={fieldErrors.title ? "revise-title-error" : undefined}
              aria-required="true"
            />
          </Field>
          <Field id="revise-body" label="Body" error={fieldErrors.body}>
            <Textarea
              id="revise-body"
              className="min-h-48"
              ref={(el) => {
                fieldRefs.current.body = el;
              }}
              value={values.body}
              onChange={(e) => setField("body", e.target.value)}
              aria-invalid={!!fieldErrors.body}
              aria-describedby={fieldErrors.body ? "revise-body-error" : undefined}
              aria-required="true"
            />
          </Field>
        </fieldset>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save revision"}
        </Button>
      </form>
    </section>
  );
}
