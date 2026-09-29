"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { createIssue } from "@/lib/api/issues";
import type { Issue } from "@/lib/api/types/issue";
import { ISSUE_CATEGORIES, ISSUE_SEVERITIES } from "@/lib/issues/classification";
import {
  EMPTY_ISSUE_REPORT,
  validateIssueReport,
  type IssueReportErrors,
  type IssueReportField,
  type IssueReportValues,
} from "@/lib/issues/report-validation";

type SubmitFailure =
  | { kind: "validation" | "failure"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "session"; message: string };

function toFailure(error: unknown): SubmitFailure {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return {
        kind: "unavailable",
        message:
          "The service is unreachable right now. Your report is still here — check your connection and try again.",
      };
    }
    if (error.status === 401) {
      return {
        kind: "session",
        message: "Your session is no longer valid. Sign in again to submit this report.",
      };
    }
    if (error.code === "VALIDATION_FAILED") {
      return { kind: "validation", message: error.message };
    }
    if (error.status === 403) {
      return { kind: "failure", message: "Your account is not permitted to report issues." };
    }
    if (error.kind === "response") {
      return { kind: "failure", message: "The service returned an unexpected response. Try again." };
    }
  }
  return { kind: "failure", message: "We could not submit your report. Try again." };
}

const FIELD_ORDER: IssueReportField[] = ["title", "description", "latitude", "longitude", "category", "severity"];

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
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

export function IssueReportForm({ onDone }: { onDone?: () => void }) {
  const [values, setValues] = React.useState<IssueReportValues>(EMPTY_ISSUE_REPORT);
  const [fieldErrors, setFieldErrors] = React.useState<IssueReportErrors>({});
  const [failure, setFailure] = React.useState<SubmitFailure | null>(null);
  const [geoError, setGeoError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<Issue | null>(null);

  // Ref guard: `pending` state updates asynchronously, so two rapid
  // submit events could both pass a state check.
  const inFlight = React.useRef(false);
  const fieldRefs = React.useRef<Partial<Record<IssueReportField, HTMLElement | null>>>({});
  const successRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (created) successRef.current?.focus();
  }, [created]);

  function setField(field: IssueReportField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: undefined }));
  }

  function describedBy(field: IssueReportField, hint?: boolean) {
    if (fieldErrors[field]) return `report-${field}-error`;
    return hint ? `report-${field}-hint` : undefined;
  }

  function useMyLocation() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("Location is not available in this browser. Enter coordinates manually.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValues((v) => ({
          ...v,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setFieldErrors((e) => ({ ...e, latitude: undefined, longitude: undefined }));
      },
      () => setGeoError("Could not read your location. Enter coordinates manually."),
      { timeout: 10_000 },
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    setFailure(null);
    const result = validateIssueReport(values);
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
      setCreated(await createIssue(result.payload));
    } catch (error) {
      setFailure(toFailure(error));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function reportAnother() {
    setValues(EMPTY_ISSUE_REPORT);
    setFieldErrors({});
    setFailure(null);
    setCreated(null);
  }

  if (created) {
    return (
      <div className="space-y-4" role="status">
        <h3 ref={successRef} tabIndex={-1} className="font-display text-lg font-semibold outline-none">
          Issue reported
        </h3>
        <p className="text-muted-foreground text-sm">
          &ldquo;{created.title}&rdquo; was submitted with status <strong>{created.status}</strong>.
        </p>
        <div className="flex gap-2">
          {onDone && <Button onClick={onDone}>Done</Button>}
          <Button variant="outline" onClick={reportAnother}>
            Report another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-busy={pending} className="space-y-4">
      {failure && (
        <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 space-y-2 rounded-md border p-3 text-sm">
          <p>{failure.message}</p>
          {failure.kind === "session" && (
            <Button asChild size="sm" variant="outline">
              <Link href="/auth/login">Sign in</Link>
            </Button>
          )}
        </div>
      )}

      <fieldset disabled={pending} className="space-y-4">
        <Field id="report-title" label="Title" error={fieldErrors.title}>
          <Input
            id="report-title"
            ref={(el) => { fieldRefs.current.title = el; }}
            value={values.title}
            onChange={(e) => setField("title", e.target.value)}
            aria-invalid={!!fieldErrors.title}
            aria-describedby={describedBy("title")}
            aria-required="true"
          />
        </Field>

        <Field id="report-description" label="Description" error={fieldErrors.description}>
          <Textarea
            id="report-description"
            ref={(el) => { fieldRefs.current.description = el; }}
            value={values.description}
            onChange={(e) => setField("description", e.target.value)}
            aria-invalid={!!fieldErrors.description}
            aria-describedby={describedBy("description")}
            aria-required="true"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id="report-latitude" label="Latitude" error={fieldErrors.latitude}>
            <Input
              id="report-latitude"
              ref={(el) => { fieldRefs.current.latitude = el; }}
              inputMode="decimal"
              value={values.latitude}
              onChange={(e) => setField("latitude", e.target.value)}
              aria-invalid={!!fieldErrors.latitude}
              aria-describedby={describedBy("latitude")}
              aria-required="true"
            />
          </Field>
          <Field id="report-longitude" label="Longitude" error={fieldErrors.longitude}>
            <Input
              id="report-longitude"
              ref={(el) => { fieldRefs.current.longitude = el; }}
              inputMode="decimal"
              value={values.longitude}
              onChange={(e) => setField("longitude", e.target.value)}
              aria-invalid={!!fieldErrors.longitude}
              aria-describedby={describedBy("longitude")}
              aria-required="true"
            />
          </Field>
        </div>
        <div className="space-y-1">
          <Button type="button" variant="outline" size="sm" onClick={useMyLocation}>
            Use my current location
          </Button>
          {geoError && <p role="status" className="text-muted-foreground text-xs">{geoError}</p>}
        </div>

        <Field
          id="report-category"
          label="Category (optional)"
          error={fieldErrors.category}
          hint={
            ISSUE_CATEGORIES.find((c) => c.value === values.category)?.description ??
            "What kind of water problem is it?"
          }
        >
          <Select
            id="report-category"
            ref={(el) => { fieldRefs.current.category = el; }}
            value={values.category}
            onChange={(e) => setField("category", e.target.value)}
            aria-invalid={!!fieldErrors.category}
            aria-describedby={describedBy("category", true)}
          >
            <option value="">Not specified</option>
            {ISSUE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Field>

        <Field
          id="report-severity"
          label="Severity (optional)"
          error={fieldErrors.severity}
          hint={
            ISSUE_SEVERITIES.find((s) => s.value === values.severity)?.description ??
            "How much is it affecting people or the environment?"
          }
        >
          <Select
            id="report-severity"
            ref={(el) => { fieldRefs.current.severity = el; }}
            value={values.severity}
            onChange={(e) => setField("severity", e.target.value)}
            aria-invalid={!!fieldErrors.severity}
            aria-describedby={describedBy("severity", true)}
          >
            <option value="">Not specified</option>
            {ISSUE_SEVERITIES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Submitting..." : "Submit report"}
      </Button>
    </form>
  );
}
