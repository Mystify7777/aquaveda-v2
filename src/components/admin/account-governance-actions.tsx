"use client";

import * as React from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ACTION_LABEL,
  DURATION_PRESETS,
  EMPTY_FIELDS,
  SUCCESS_MESSAGE,
  availableGovernanceActions,
  classifyGovernanceFailure,
  validateGovernanceForm,
  type FieldErrors,
  type GovernanceAction,
  type GovernanceFailure,
  type GovernanceFields,
  type GovernanceRequest,
} from "@/lib/accounts/governance-actions";
import { REASON_MAX_LENGTH, SAFE_REASON_MAX_LENGTH } from "@/lib/accounts/governance-contract";
import { stateLabel } from "@/lib/accounts/presentation";
import { liftMute, liftSuspension, muteAccount, suspendAccount } from "@/lib/api/account-governance";
import type { AdminAccountEntry } from "@/lib/api/types/accounts";
import { formatDateTime } from "@/lib/format-date";

function send(userId: string, request: GovernanceRequest) {
  switch (request.action) {
    case "mute":
      return muteAccount(userId, request.input);
    case "suspend":
      return suspendAccount(userId, request.input);
    case "liftMute":
      return liftMute(userId, request.input);
    case "liftSuspension":
      return liftSuspension(userId, request.input);
  }
}

const DESCRIPTION: Record<GovernanceAction, string> = {
  mute: "A muted account can still read AquaVeda, but cannot post, report or make other contributions until the mute ends.",
  suspend: "A suspended account is signed out and cannot use signed-in features until the suspension ends or is lifted.",
  liftMute: "The account will be able to contribute again immediately.",
  liftSuspension: "The account will be able to sign in and use AquaVeda again.",
};

const SUBMIT_LABEL: Record<GovernanceAction, string> = {
  mute: "Mute account",
  suspend: "Review suspension",
  liftMute: "Lift mute",
  liftSuspension: "Lift suspension",
};

const fieldClass = "space-y-1";
const hintClass = "text-muted-foreground text-xs";
const errorClass = "text-destructive text-xs";

/**
 * Admin governance controls for one USER/EXPERT account (#264). Composes the
 * existing mutation endpoints; the backend is the only authority (ADR-0012 target
 * rules, state preconditions, atomic writes) and its answer is presented, never
 * second-guessed. What is offered follows the persisted account state, and nothing
 * is offered for Admins or the viewer's own account.
 *
 * Safety properties: one request at a time (a ref lock, not just `disabled`); no
 * automatic retry, ever; failures whose outcome is unknown or whose premise changed
 * are handed to `onReconcile` so the parent re-reads the server; the private reason
 * is cleared when the dialog closes and is never displayed back.
 */
export function AccountGovernanceActions({
  entry,
  viewerId,
  busy = false,
  now = () => new Date(),
  onOpen,
  onApplied,
  onReconcile,
}: {
  entry: AdminAccountEntry;
  viewerId: string | undefined;
  /** A post-mutation refresh is in flight: do not offer actions against a state that may be stale. */
  busy?: boolean;
  now?: () => Date;
  /** A dialog is about to open: the parent clears any previous outcome message. */
  onOpen?: () => void;
  onApplied: (message: string) => void;
  onReconcile: (failure: GovernanceFailure) => void;
}) {
  const actions = availableGovernanceActions(entry, viewerId);
  const [action, setAction] = React.useState<GovernanceAction | null>(null);
  const [step, setStep] = React.useState<"form" | "confirm">("form");
  const [fields, setFields] = React.useState<GovernanceFields>(EMPTY_FIELDS);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [failure, setFailure] = React.useState<GovernanceFailure | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingRequest, setPendingRequest] = React.useState<GovernanceRequest | null>(null);
  const inFlight = React.useRef(false);

  // Nothing at all (not even an explanation) for Admin targets, the viewer's own account, or an unknown
  // viewer: the existing operator-managed note covers Admin/own rows (ADR-0012).
  if (viewerId === undefined) return null;
  if (entry.role !== "USER" && entry.role !== "EXPERT") return null;
  if (entry.id === viewerId) return null;

  const set = <K extends keyof GovernanceFields>(key: K, value: GovernanceFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  function open(next: GovernanceAction) {
    if (inFlight.current) return;
    onOpen?.();
    setFields(EMPTY_FIELDS);
    setErrors({});
    setFailure(null);
    setPendingRequest(null);
    setStep("form");
    setAction(next);
  }

  function close() {
    if (inFlight.current) return; // never abandon a request that is in flight
    setAction(null);
    setFields(EMPTY_FIELDS); // the private reason does not outlive the dialog
    setPendingRequest(null);
    setFailure(null);
    setErrors({});
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || action === null) return;

    const result = validateGovernanceForm(action, fields, now());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});

    if (action === "suspend" && step === "form") {
      setPendingRequest(result.request); // confirmation step: nothing is sent yet
      setStep("confirm");
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      await send(entry.id, result.request);
      inFlight.current = false;
      setSubmitting(false);
      setAction(null);
      setFields(EMPTY_FIELDS);
      setPendingRequest(null);
      onApplied(SUCCESS_MESSAGE[action](entry.name));
    } catch (error) {
      const classified = classifyGovernanceFailure(error);
      inFlight.current = false;
      setSubmitting(false);
      if (classified.closesDialog) {
        setAction(null);
        setFields(EMPTY_FIELDS);
        setPendingRequest(null);
        onReconcile(classified); // re-read the server; the mutation is NOT re-sent
      } else {
        setFailure(classified);
        if (classified.kind === "validation") setStep("form");
      }
    }
  }

  const locked = busy || submitting;
  const ids = { reason: "gov-reason", safe: "gov-safe-reason", duration: "gov-duration", end: "gov-end" };

  return (
    <section aria-label="Governance actions" className="border-border space-y-3 border-t pt-4">
      <h3 className="font-display text-base font-semibold">Governance actions</h3>
      {entry.restriction?.lapsed && (
        <p className="text-muted-foreground text-sm">
          This restriction has expired and will clear automatically. You can also lift it now.
        </p>
      )}
      {actions.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No governance actions are available while this account is {stateLabel(entry.accountState).toLowerCase()}.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button key={a} variant={a === "suspend" ? "outline" : "default"} size="sm" disabled={locked} onClick={() => open(a)}>
              {ACTION_LABEL[a]}
            </Button>
          ))}
        </div>
      )}

      <DialogPrimitive.Root open={action !== null} onOpenChange={(next) => !next && close()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
          <DialogPrimitive.Content
            onEscapeKeyDown={(e) => submitting && e.preventDefault()}
            onPointerDownOutside={(e) => submitting && e.preventDefault()}
            onInteractOutside={(e) => submitting && e.preventDefault()}
            className="bg-background fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border p-5 shadow-xl"
          >
            {action !== null && (
              <form onSubmit={submit} noValidate aria-busy={submitting} className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <DialogPrimitive.Title className="font-display text-lg font-semibold">
                      {step === "confirm" ? `Confirm suspension of ${entry.name}` : `${ACTION_LABEL[action]}: ${entry.name}`}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="text-muted-foreground text-sm">
                      {DESCRIPTION[action]}
                    </DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="Close" disabled={submitting}>
                      <X className="size-4" />
                    </Button>
                  </DialogPrimitive.Close>
                </div>

                {failure && (
                  <div role="alert" className="text-destructive border-destructive/30 bg-destructive/5 space-y-1 rounded-md border p-3 text-sm">
                    <p>{failure.message}</p>
                    {failure.kind === "session" && (
                      <p>
                        <Link href="/auth/login" className="underline">
                          Sign in
                        </Link>
                      </p>
                    )}
                  </div>
                )}

                {step === "confirm" && pendingRequest?.action === "suspend" ? (
                  <dl className="border-border space-y-2 rounded-md border p-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground text-xs">Account</dt>
                      <dd>
                        {entry.name} ({entry.role === "EXPERT" ? "Expert" : "User"})
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Duration</dt>
                      <dd>
                        {pendingRequest.input.kind === "INDEFINITE"
                          ? "Indefinite: until an administrator lifts it"
                          : `Until ${formatDateTime(pendingRequest.input.expiresAt)}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Private reason</dt>
                      <dd>Provided (recorded for the audit, not shown to the account holder)</dd>
                    </div>
                  </dl>
                ) : (
                  <>
                    {action === "suspend" && (
                      <fieldset className={fieldClass} disabled={submitting}>
                        <legend className="text-sm font-medium">Type</legend>
                        {(["INDEFINITE", "TEMPORARY"] as const).map((kind) => (
                          <label key={kind} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="suspend-kind"
                              checked={fields.suspendKind === kind}
                              onChange={() => set("suspendKind", kind)}
                            />
                            {kind === "INDEFINITE" ? "Indefinite (until lifted)" : "Temporary (ends automatically)"}
                          </label>
                        ))}
                      </fieldset>
                    )}

                    {(action === "mute" || (action === "suspend" && fields.suspendKind === "TEMPORARY")) && (
                      <fieldset className={fieldClass} disabled={submitting} aria-describedby={errors.duration ? `${ids.duration}-error` : undefined}>
                        <legend className="text-sm font-medium">{action === "mute" ? "Mute for" : "Suspend for"}</legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {DURATION_PRESETS.map((p) => (
                            <label key={p.id} className="flex items-center gap-2 text-sm">
                              <input type="radio" name="duration" checked={fields.duration === p.id} onChange={() => set("duration", p.id)} />
                              {p.label}
                            </label>
                          ))}
                          <label className="flex items-center gap-2 text-sm">
                            <input type="radio" name="duration" checked={fields.duration === "custom"} onChange={() => set("duration", "custom")} />
                            Custom
                          </label>
                        </div>
                        {fields.duration === "custom" && (
                          <div className="space-y-1">
                            <label htmlFor={ids.end} className="text-sm font-medium">
                              Ends at
                            </label>
                            <Input
                              id={ids.end}
                              type="datetime-local"
                              value={fields.customEnd}
                              onChange={(e) => set("customEnd", e.target.value)}
                              aria-invalid={errors.duration ? true : undefined}
                            />
                          </div>
                        )}
                        {errors.duration && (
                          <p id={`${ids.duration}-error`} className={errorClass}>
                            {errors.duration}
                          </p>
                        )}
                      </fieldset>
                    )}

                    <div className={fieldClass}>
                      <label htmlFor={ids.reason} className="text-sm font-medium">
                        {action === "suspend" ? "Private reason (required)" : "Private reason (optional)"}
                      </label>
                      <Textarea
                        id={ids.reason}
                        value={fields.reason}
                        onChange={(e) => set("reason", e.target.value)}
                        disabled={submitting}
                        rows={3}
                        aria-invalid={errors.reason ? true : undefined}
                        aria-describedby={`${ids.reason}-hint${errors.reason ? ` ${ids.reason}-error` : ""}`}
                      />
                      <p id={`${ids.reason}-hint`} className={hintClass}>
                        Recorded for the governance audit. Never shown to the account holder. Up to {REASON_MAX_LENGTH} characters.
                      </p>
                      {errors.reason && (
                        <p id={`${ids.reason}-error`} className={errorClass}>
                          {errors.reason}
                        </p>
                      )}
                    </div>

                    {(action === "mute" || action === "suspend") && (
                      <div className={fieldClass}>
                        <label htmlFor={ids.safe} className="text-sm font-medium">
                          Message shown to the account holder (optional)
                        </label>
                        <Textarea
                          id={ids.safe}
                          value={fields.safeReason}
                          onChange={(e) => set("safeReason", e.target.value)}
                          disabled={submitting}
                          rows={2}
                          aria-invalid={errors.safeReason ? true : undefined}
                          aria-describedby={`${ids.safe}-hint${errors.safeReason ? ` ${ids.safe}-error` : ""}`}
                        />
                        <p id={`${ids.safe}-hint`} className={hintClass}>
                          Visible to the account holder: do not include private notes. Up to {SAFE_REASON_MAX_LENGTH} characters.
                        </p>
                        {errors.safeReason && (
                          <p id={`${ids.safe}-error`} className={errorClass}>
                            {errors.safeReason}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-end gap-2">
                  {step === "confirm" ? (
                    <Button type="button" variant="ghost" onClick={() => setStep("form")} disabled={submitting}>
                      Back
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" onClick={close} disabled={submitting}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" variant={step === "confirm" ? "destructive" : "default"} disabled={submitting}>
                    {submitting ? "Applying..." : step === "confirm" ? "Suspend account" : SUBMIT_LABEL[action]}
                  </Button>
                </div>
              </form>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
  );
}
