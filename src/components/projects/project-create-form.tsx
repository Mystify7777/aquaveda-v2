"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { createProject } from "@/lib/api/projects";
import type { CreatedProject } from "@/lib/api/types/project";
import {
  EMPTY_PROJECT_CREATION,
  validateProjectCreation,
  type ProjectCreationErrors,
  type ProjectCreationField,
  type ProjectCreationValues,
} from "@/lib/projects/creation-validation";

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
          "The service is unreachable right now. Your project is still here — check your connection and try again.",
      };
    }
    if (error.status === 401) {
      return {
        kind: "session",
        message: "Your session is no longer valid. Sign in again to create this project.",
      };
    }
    if (error.code === "VALIDATION_FAILED") {
      return { kind: "validation", message: error.message };
    }
    if (error.status === 403) {
      return { kind: "failure", message: "Your account is not permitted to create projects." };
    }
    if (error.status === 404) {
      return { kind: "failure", message: "No issue was found with that origin issue ID." };
    }
    if (error.code === "INVALID_STATE") {
      // Backend message states the ineligible status; forwarded verbatim.
      return { kind: "failure", message: error.message };
    }
    if (error.kind === "response") {
      return { kind: "failure", message: "The service returned an unexpected response. Try again." };
    }
  }
  return { kind: "failure", message: "We could not create your project. Try again." };
}

const FIELD_ORDER: ProjectCreationField[] = ["title", "description", "originIssue"];

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hasHint: boolean, hasError: boolean) {
  const ids = [hasHint && `${id}-hint`, hasError && `${id}-error`].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

/**
 * Project creation primitive (#47). Auth gating is the route's job
 * (protected layout → RequireAuth); origin-issue existence, eligibility and
 * authorization are backend-authoritative. Mount-agnostic: #52 relocates it.
 */
export function ProjectCreateForm() {
  const [values, setValues] = React.useState<ProjectCreationValues>(EMPTY_PROJECT_CREATION);
  const [fieldErrors, setFieldErrors] = React.useState<ProjectCreationErrors>({});
  const [failure, setFailure] = React.useState<SubmitFailure | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedProject | null>(null);

  // Ref guard: `pending` state lags a render, so rapid double submits could both pass a state check.
  const inFlight = React.useRef(false);
  const fieldRefs = React.useRef<Partial<Record<ProjectCreationField, HTMLElement | null>>>({});
  const successRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (created) successRef.current?.focus();
  }, [created]);

  function setField(field: ProjectCreationField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    setFailure(null);
    const result = validateProjectCreation(values);
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
      setCreated(await createProject(result.payload));
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function createAnother() {
    setValues(EMPTY_PROJECT_CREATION);
    setFieldErrors({});
    setFailure(null);
    setCreated(null);
  }

  if (created) {
    return (
      <div className="space-y-4" role="status">
        <h2 ref={successRef} tabIndex={-1} className="font-display text-lg font-semibold outline-none">
          Project created
        </h2>
        <p className="text-muted-foreground text-sm">
          &ldquo;{created.title}&rdquo; was created from issue <strong>{created.originIssue}</strong>.
        </p>
        <Button variant="outline" onClick={createAnother}>
          Create another
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
        <Field id="project-title" label="Title" error={fieldErrors.title}>
          <Input
            id="project-title"
            ref={(el) => {
              fieldRefs.current.title = el;
            }}
            value={values.title}
            onChange={(e) => setField("title", e.target.value)}
            aria-invalid={!!fieldErrors.title}
            aria-describedby={describedBy("project-title", false, !!fieldErrors.title)}
            aria-required="true"
          />
        </Field>

        <Field id="project-description" label="Description" error={fieldErrors.description}>
          <Textarea
            id="project-description"
            className="min-h-32"
            ref={(el) => {
              fieldRefs.current.description = el;
            }}
            value={values.description}
            onChange={(e) => setField("description", e.target.value)}
            aria-invalid={!!fieldErrors.description}
            aria-describedby={describedBy("project-description", false, !!fieldErrors.description)}
            aria-required="true"
          />
        </Field>

        <Field
          id="project-origin-issue"
          label="Origin issue ID"
          hint="The ID of the existing issue this project addresses."
          error={fieldErrors.originIssue}
        >
          <Input
            id="project-origin-issue"
            ref={(el) => {
              fieldRefs.current.originIssue = el;
            }}
            value={values.originIssue}
            onChange={(e) => setField("originIssue", e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!fieldErrors.originIssue}
            aria-describedby={describedBy("project-origin-issue", true, !!fieldErrors.originIssue)}
            aria-required="true"
          />
        </Field>
      </fieldset>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating..." : "Create project"}
      </Button>
    </form>
  );
}
