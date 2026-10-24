import type { ExpertSubmission } from "@/lib/api/types/expert-application";
import { expertiseLabel, normalizeReferenceUrl } from "@/lib/expert/submission-contract";
import { formatDate } from "@/lib/format-date";

/**
 * A reference link. Only a URL that passes the SAME https/no-credentials rules
 * the server enforces is rendered as a link (shown as its hostname, opening in a
 * new tab with noopener/noreferrer/nofollow). Anything else is plain text.
 * A link is never evidence of expertise, only something the reviewer may open.
 */
export function ReferenceLink({ href }: { href: string }) {
  const parsed = normalizeReferenceUrl(href);
  if (!parsed.ok) return <span className="break-all">{href}</span>;
  const { hostname } = new URL(parsed.value);
  return (
    <a
      href={parsed.value}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={`${hostname} (opens in a new tab)`}
      className="text-primary underline-offset-4 hover:underline"
    >
      {hostname}
    </a>
  );
}

/**
 * Read-only view of one submission, shared by the applicant and the reviewer.
 * All text is rendered as plain text (never HTML). `null` is a legacy
 * application submitted before details were collected: stated explicitly, never
 * shown as an empty submission.
 */
export function SubmissionDetails({
  submission,
  legacyMessage,
}: {
  submission: ExpertSubmission | null | undefined;
  legacyMessage: string;
}) {
  if (!submission) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="legacy-submission">
        {legacyMessage}
      </p>
    );
  }
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="text-muted-foreground">Areas of expertise</dt>
        <dd>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {submission.expertiseAreas.map((area) => (
              <li key={area} className="bg-muted rounded-full px-2.5 py-0.5 text-xs">
                {expertiseLabel(area)}
              </li>
            ))}
          </ul>
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Experience</dt>
        <dd className="leading-relaxed break-words whitespace-pre-wrap">{submission.experience}</dd>
      </div>
      {submission.affiliation && (
        <div>
          <dt className="text-muted-foreground">Affiliation</dt>
          <dd>{submission.affiliation}</dd>
        </div>
      )}
      {submission.references.length > 0 && (
        <div>
          <dt className="text-muted-foreground">References</dt>
          <dd>
            <ul className="mt-1 space-y-1">
              {submission.references.map((ref) => (
                <li key={ref}>
                  <ReferenceLink href={ref} />
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
      {submission.acknowledgement && (
        <div>
          <dt className="text-muted-foreground">Acknowledgement</dt>
          <dd>Accepted {formatDate(submission.acknowledgement.acceptedAt)}</dd>
        </div>
      )}
    </dl>
  );
}
