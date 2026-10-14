"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { createKnowledge } from "@/lib/api/knowledge";
import { KnowledgeFormField as Field } from "@/components/knowledge/knowledge-form-field";
import { KnowledgeSubmitAction } from "@/components/knowledge/knowledge-submit-action";
import type { CreatedKnowledgeDraft, KnowledgeLifecycleResult } from "@/lib/api/types/knowledge";
import {
  EMPTY_KNOWLEDGE_DRAFT,
  validateKnowledgeDraft,
  type KnowledgeDraftErrors,
  type KnowledgeDraftField,
  type KnowledgeDraftValues,
} from "@/lib/knowledge/draft-validation";

type SubmitFailure = {
  kind: "validation" | "failure" | "unavailable" | "session";
  message: string;
};

function toFailure(error: unknown): SubmitFailure {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return {
        kind: "unavailable",
        message:
          "The service is unreachable right now. Your draft is still here — check your connection and try again.",
      };
    }
    if (error.status === 401) {
      return {
        kind: "session",
        message: "Your session is no longer valid. Sign in again to save this draft.",
      };
    }
    if (error.code === "VALIDATION_FAILED") {
      return { kind: "validation", message: error.message };
    }
    if (error.status === 403) {
      return { kind: "failure", message: "Your account is not permitted to create drafts." };
    }
    if (error.kind === "response") {
      return { kind: "failure", message: "The service returned an unexpected response. Try again." };
    }
  }
  return { kind: "failure", message: "We could not save your draft. Try again." };
}

const FIELD_ORDER: KnowledgeDraftField[] = ["title", "body"];

/**
 * Draft creation only. Auth gating is the route's job ((protected) layout →
 * RequireAuth); backend authorization stays authoritative.
 */
export function KnowledgeDraftForm() {
  const [values, setValues] = React.useState<KnowledgeDraftValues>(EMPTY_KNOWLEDGE_DRAFT);
  const [fieldErrors, setFieldErrors] = React.useState<KnowledgeDraftErrors>({});
  const [failure, setFailure] = React.useState<SubmitFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedKnowledgeDraft | null>(null);
  const [submitted, setSubmitted] = React.useState<KnowledgeLifecycleResult | null>(null);

  // Ref guard: `pending` state lags a render, so rapid double submits could both pass a state check.
  const inFlight = React.useRef(false);
  const fieldRefs = React.useRef<Partial<Record<KnowledgeDraftField, HTMLElement | null>>>({});
  const successRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (created) successRef.current?.focus();
  }, [created]);

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
      setCreated(await createKnowledge(result.payload));
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function writeAnother() {
    setValues(EMPTY_KNOWLEDGE_DRAFT);
    setFieldErrors({});
    setFailure(null);
    setCreated(null);
    setSubmitted(null);
  }

  if (created) {
    return (
      <div className="space-y-4" role="status">
        <h2 ref={successRef} tabIndex={-1} className="font-display text-lg font-semibold outline-none">
          Draft saved
        </h2>
        {submitted ? (
          <p className="text-muted-foreground text-sm">
            &ldquo;{submitted.title}&rdquo; was submitted for review with status{" "}
            <strong>{submitted.status}</strong>.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              &ldquo;{created.title}&rdquo; was saved with status <strong>{created.status}</strong>. It has not been
              submitted for review.
            </p>
            <KnowledgeSubmitAction knowledgeId={created._id} onSubmitted={setSubmitted} />
          </>
        )}
        <Button variant="outline" onClick={writeAnother}>
          Write another
        </Button>
      </div>
    );
  }

  return (
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
        <Field id="draft-title" label="Title" error={fieldErrors.title}>
          <Input
            id="draft-title"
            ref={(el) => {
              fieldRefs.current.title = el;
            }}
            value={values.title}
            onChange={(e) => setField("title", e.target.value)}
            aria-invalid={!!fieldErrors.title}
            aria-describedby={fieldErrors.title ? "draft-title-error" : undefined}
            aria-required="true"
          />
        </Field>

        <Field id="draft-body" label="Body" error={fieldErrors.body}>
          <Textarea
            id="draft-body"
            className="min-h-48"
            ref={(el) => {
              fieldRefs.current.body = el;
            }}
            value={values.body}
            onChange={(e) => setField("body", e.target.value)}
            aria-invalid={!!fieldErrors.body}
            aria-describedby={fieldErrors.body ? "draft-body-error" : undefined}
            aria-required="true"
          />
        </Field>
      </fieldset>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving..." : "Save draft"}
      </Button>
    </form>
  );
}
