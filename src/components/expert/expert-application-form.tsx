"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExpertSubmissionRequest } from "@/lib/api/types/expert-application";
import type { ExpertActionFailure } from "@/lib/expert/action-failure";
import {
  CURRENT_ACKNOWLEDGEMENT_TEXT,
  EXPERIENCE_MAX_LENGTH,
  EXPERIENCE_MIN_LENGTH,
  EXPERTISE_AREAS,
  EXPERTISE_AREAS_MAX,
  REFERENCES_MAX,
  AFFILIATION_MAX_LENGTH,
} from "@/lib/expert/submission-contract";
import {
  emptyDraft,
  firstInvalidField,
  validateDraft,
  type DraftErrors,
  type SubmissionDraft,
} from "@/lib/expert/submission-form";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-destructive text-sm">
      {message}
    </p>
  );
}

/**
 * The Expert application form. Controlled state, no form library: every rule
 * comes from the shared contract (`validateDraft`), so client and server cannot
 * disagree. Errors appear after the first submit attempt; focus then moves to the
 * first invalid control. The acknowledgement is shown verbatim from the contract
 * next to its checkbox and is never pre-accepted. Submitting is blocked while a
 * request is in flight (`pending`), and the parent also guards against double sends.
 */
export function ExpertApplicationForm({
  initial,
  pending,
  failure,
  submitLabel,
  onSubmit,
}: {
  initial?: SubmissionDraft;
  pending: boolean;
  failure: ExpertActionFailure | null;
  submitLabel: string;
  onSubmit: (request: ExpertSubmissionRequest) => void;
}) {
  const [draft, setDraft] = React.useState<SubmissionDraft>(initial ?? emptyDraft());
  const [errors, setErrors] = React.useState<DraftErrors>({});
  const [attempted, setAttempted] = React.useState(false);
  const fields = React.useRef<Record<string, HTMLElement | null>>({});
  const uid = React.useId();
  const id = (name: string) => `${uid}-${name}`;

  const set = <K extends keyof SubmissionDraft>(key: K, value: SubmissionDraft[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (attempted) {
      const result = validateDraft(next);
      setErrors(result.ok ? {} : result.errors); // keep errors truthful as the user fixes them
    }
  };

  function toggleArea(value: string) {
    const has = draft.expertiseAreas.includes(value);
    if (!has && draft.expertiseAreas.length >= EXPERTISE_AREAS_MAX) return;
    set(
      "expertiseAreas",
      has ? draft.expertiseAreas.filter((v) => v !== value) : [...draft.expertiseAreas, value],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setAttempted(true);
    const result = validateDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      const first = firstInvalidField(result.errors, draft.references.length);
      if (first) fields.current[first]?.focus();
      return;
    }
    setErrors({});
    onSubmit(result.request);
  }

  const errorIds = (name: string) => (errors[name] ? id(`${name}-error`) : undefined);
  const trimmedExperience = draft.experience.trim().length;
  const invalidCount = Object.keys(errors).length;

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={pending} className="space-y-6">
      {attempted && invalidCount > 0 && (
        <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">
          Please fix {invalidCount === 1 ? "the highlighted field" : `the ${invalidCount} highlighted fields`} and submit again.
        </div>
      )}

      {failure && (
        <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 space-y-2 rounded-md border p-3 text-sm">
          <p>{failure.message}</p>
          {failure.kind === "session" && (
            <Button asChild size="sm">
              <Link href="/auth/login">Sign in</Link>
            </Button>
          )}
        </div>
      )}

      <fieldset className="space-y-2" aria-describedby={`${id("areas-hint")} ${errorIds("expertiseAreas") ?? ""}`.trim()}>
        <legend className="text-sm font-medium">Areas of expertise</legend>
        <p id={id("areas-hint")} className="text-muted-foreground text-xs">
          Choose 1 to {EXPERTISE_AREAS_MAX}.{" "}
          <span aria-live="polite">
            {draft.expertiseAreas.length}/{EXPERTISE_AREAS_MAX} selected
          </span>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {EXPERTISE_AREAS.map((area: { value: string; label: string; description: string }, i: number) => {
            const checked = draft.expertiseAreas.includes(area.value);
            const full = !checked && draft.expertiseAreas.length >= EXPERTISE_AREAS_MAX;
            return (
              <label
                key={area.value}
                className="border-border has-[:checked]:border-primary flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              >
                <input
                  ref={i === 0 ? (el) => void (fields.current.expertiseAreas = el) : undefined}
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked}
                  disabled={full || pending}
                  onChange={() => toggleArea(area.value)}
                />
                <span>
                  <span className="font-medium">{area.label}</span>
                  <span className="text-muted-foreground block text-xs">{area.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <FieldError id={id("expertiseAreas-error")} message={errors.expertiseAreas} />
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor={id("experience")} className="text-sm font-medium">
          What have you worked on, where, and for how long?
        </label>
        <Textarea
          id={id("experience")}
          ref={(el) => void (fields.current.experience = el)}
          className="min-h-36"
          value={draft.experience}
          maxLength={EXPERIENCE_MAX_LENGTH}
          onChange={(e) => set("experience", e.target.value)}
          disabled={pending}
          aria-invalid={Boolean(errors.experience)}
          aria-describedby={`${id("experience-hint")} ${errorIds("experience") ?? ""}`.trim()}
        />
        <p id={id("experience-hint")} className="text-muted-foreground text-xs">
          {trimmedExperience}/{EXPERIENCE_MAX_LENGTH} characters, at least {EXPERIENCE_MIN_LENGTH}. Administrators read
          this when they decide; it is not shown publicly.
        </p>
        <FieldError id={id("experience-error")} message={errors.experience} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={id("affiliation")} className="text-sm font-medium">
          Organisation or affiliation <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id={id("affiliation")}
          ref={(el) => void (fields.current.affiliation = el)}
          value={draft.affiliation}
          maxLength={AFFILIATION_MAX_LENGTH}
          onChange={(e) => set("affiliation", e.target.value)}
          disabled={pending}
          aria-invalid={Boolean(errors.affiliation)}
          aria-describedby={errorIds("affiliation")}
        />
        <FieldError id={id("affiliation-error")} message={errors.affiliation} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          References <span className="text-muted-foreground font-normal">(optional)</span>
        </legend>
        <p className="text-muted-foreground text-xs">
          Up to {REFERENCES_MAX} https links, such as a profile, publication or organisation page. A link helps a
          reviewer, but it is not treated as proof of expertise, and practical or community experience is welcome
          without one.
        </p>
        <ul className="space-y-2">
          {draft.references.map((value, i) => (
            <li key={i} className="space-y-1">
              <div className="flex gap-2">
                <label htmlFor={id(`ref-${i}`)} className="sr-only">
                  Reference {i + 1}
                </label>
                <Input
                  id={id(`ref-${i}`)}
                  ref={(el) => void (fields.current[`references.${i}`] = el)}
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={value}
                  onChange={(e) =>
                    set(
                      "references",
                      draft.references.map((r, j) => (j === i ? e.target.value : r)),
                    )
                  }
                  disabled={pending}
                  aria-invalid={Boolean(errors[`references.${i}`])}
                  aria-describedby={errorIds(`references.${i}`)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set("references", draft.references.filter((_, j) => j !== i))}
                  disabled={pending}
                  aria-label={`Remove reference ${i + 1}`}
                >
                  Remove
                </Button>
              </div>
              <FieldError id={id(`references.${i}-error`)} message={errors[`references.${i}`]} />
            </li>
          ))}
        </ul>
        <FieldError id={id("references-error")} message={errors.references} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => set("references", [...draft.references, ""])}
          disabled={pending || draft.references.length >= REFERENCES_MAX}
        >
          Add a reference
        </Button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Before you submit</legend>
        <p className="text-sm">By submitting this application you agree to:</p>
        <label className="border-border flex items-start gap-2 rounded-md border p-3 text-sm leading-relaxed">
          <input
            ref={(el) => void (fields.current.acknowledgement = el)}
            type="checkbox"
            className="mt-1"
            checked={draft.acknowledged}
            onChange={(e) => set("acknowledged", e.target.checked)}
            disabled={pending}
            aria-invalid={Boolean(errors.acknowledgement)}
            aria-describedby={errorIds("acknowledgement")}
          />
          <span>{CURRENT_ACKNOWLEDGEMENT_TEXT}</span>
        </label>
        <FieldError id={id("acknowledgement-error")} message={errors.acknowledgement} />
      </fieldset>

      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Submitting..." : submitLabel}
      </Button>
    </form>
  );
}
