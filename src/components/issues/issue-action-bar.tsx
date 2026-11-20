"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { executeIssueAction, getIssueWorkflow, type IssueWorkflow } from "@/lib/api/issue-workflow";
import { useApiResource } from "@/lib/api/use-api-resource";
import {
  ACTION_SPECS,
  describeActionFailure,
  isKnownAction,
  validateActionInput,
  type ActionFailure,
  type ActionInput,
  type WorkflowAction,
} from "@/lib/issues/issue-actions";

function ActionForm({
  action,
  pending,
  onSubmit,
  onCancel,
  onEdit,
}: {
  action: WorkflowAction;
  pending: boolean;
  onSubmit: (input: ActionInput) => void;
  onCancel: () => void;
  /** Editing a field invalidates the previous submission error. */
  onEdit: () => void;
}) {
  const spec = ACTION_SPECS[action];
  const uid = useId();
  const [input, setInput] = useState<ActionInput>({ note: "", granteeId: "" });
  const [errors, setErrors] = useState<{ note?: string; granteeId?: string }>({});

  function edit(field: keyof ActionInput, value: string) {
    setInput((p) => ({ ...p, [field]: value }));
    setErrors((p) => ({ ...p, [field]: undefined }));
    onEdit();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validateActionInput(action, input);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(input);
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={spec.label} className="mt-3 space-y-3">
      {spec.grantee && (
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${uid}-grantee`}>Grantee user ID</label>
          <Input
            id={`${uid}-grantee`}
            value={input.granteeId}
            onChange={(e) => edit("granteeId", e.target.value)}
            aria-invalid={Boolean(errors.granteeId)}
            aria-describedby={errors.granteeId ? `${uid}-grantee-err` : undefined}
            disabled={pending}
            autoComplete="off"
          />
          {errors.granteeId && (
            <p id={`${uid}-grantee-err`} role="alert" className="text-sm">
              {errors.granteeId}
            </p>
          )}
        </div>
      )}
      {spec.consequence && (
        <p className="bg-muted/50 text-muted-foreground rounded-md border p-3 text-sm leading-5">
          {spec.consequence}
        </p>
      )}
      {spec.note !== "none" && (
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`${uid}-note`}>
            {spec.noteLabel ?? "Note"} {spec.note === "optional" ? "(optional)" : "(required)"}
          </label>
          <Textarea
            id={`${uid}-note`}
            value={input.note}
            onChange={(e) => edit("note", e.target.value)}
            aria-invalid={Boolean(errors.note)}
            aria-describedby={errors.note ? `${uid}-note-err` : undefined}
            disabled={pending}
            rows={3}
          />
          {errors.note && (
            <p id={`${uid}-note-err`} role="alert" className="text-sm">
              {errors.note}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant={spec.destructive ? "destructive" : "default"}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Submitting…" : spec.confirmLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function IssueActionBar({ issueId }: { issueId: string }) {
  const router = useRouter();
  // `scope` identifies one authoritative read. Bumping the epoch re-reads /workflow
  // (new useApiResource key) and implicitly invalidates anything adopted earlier.
  const [epoch, setEpoch] = useState(0);
  const epochRef = useRef(0);
  const scopeOf = (n: number) => `${issueId}:${n}`;
  const scope = scopeOf(epoch);
  const { resource } = useApiResource(
    (signal) => getIssueWorkflow(issueId, { signal }),
    `issue-workflow:${scope}`,
  );
  const [adopted, setAdopted] = useState<{ scope: string; workflow: IssueWorkflow } | null>(null);
  const [notice, setNotice] = useState<{ scope: string; text: string } | null>(null);
  const [activeId, setActiveId] = useState<WorkflowAction | null>(null);
  const [pendingId, setPendingId] = useState<WorkflowAction | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const reload = () => {
    epochRef.current += 1;
    setEpoch(epochRef.current);
  };

  const workflow =
    adopted?.scope === scope ? adopted.workflow : resource.status === "success" ? resource.data : null;

  // Server order preserved; unknown identifiers dropped; duplicates collapsed.
  const actions: WorkflowAction[] = workflow ? [...new Set(workflow.actions.filter(isKnownAction))] : [];
  // Derived: if a reload removed the action, its form disappears with it.
  const active = activeId && actions.includes(activeId) ? activeId : null;
  // The explanation for a stale-capability reload is shown only once that re-read has landed.
  const shownMessage = message ?? (workflow && notice?.scope === scope ? notice.text : null);

  async function run(action: WorkflowAction, input: ActionInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingId(action);
    setFailure(null);
    setMessage(null);
    try {
      const result = await executeIssueAction(issueId, action, input);
      setAdopted({ scope: scopeOf(epochRef.current), workflow: result.workflow });
      setActiveId(null);
      setMessage(`${ACTION_SPECS[action].label}: done.`);
      router.refresh();
    } catch (error) {
      const next = describeActionFailure(error);
      if (next.refresh) router.refresh();
      if (next.reload) {
        // Authoritative re-read; never retry the mutation.
        reload();
        setNotice({ scope: scopeOf(epochRef.current), text: next.message });
      } else {
        setFailure(next);
      }
    } finally {
      inFlight.current = false;
      setPendingId(null);
    }
  }

  function choose(action: WorkflowAction) {
    if (inFlight.current) return;
    setFailure(null);
    setMessage(null);
    if (ACTION_SPECS[action].note === "none" && !ACTION_SPECS[action].grantee) {
      void run(action, { note: "", granteeId: "" });
    } else {
      setActiveId(action);
    }
  }

  if (!workflow) {
    if (resource.status !== "error") return null; // loading
    const denied = resource.error.status === 401 || resource.error.status === 403;
    if (denied) return null; // anonymous / not permitted: no controls
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        <span>Couldn&apos;t load available actions.</span>
        <Button type="button" variant="outline" onClick={reload}>
          Retry
        </Button>
      </div>
    );
  }

  if (actions.length === 0 && !shownMessage && !failure) return null;

  return (
    <section aria-label="Issue actions" className="rounded-lg border p-4">
      {shownMessage && (
        <p role="status" className="mb-3 text-sm">
          {shownMessage}
        </p>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action}
              type="button"
              variant="outline"
              onClick={() => choose(action)}
              disabled={pendingId !== null}
              aria-busy={pendingId === action}
              aria-expanded={active === action}
            >
              {ACTION_SPECS[action].label}
            </Button>
          ))}
        </div>
      )}
      {active && (
        <ActionForm
          key={active}
          action={active}
          pending={pendingId === active}
          onSubmit={(input) => void run(active, input)}
          onCancel={() => setActiveId(null)}
          onEdit={() => setFailure(null)}
        />
      )}
      {failure && (
        <p role="alert" className="mt-3 text-sm">
          {failure.message}{" "}
          {failure.signIn && (
            <Link href="/auth/login" className="underline">
              Sign in
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
