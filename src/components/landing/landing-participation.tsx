const ROLES = [
  {
    label: "Community",
    action: "Discover · report",
    description: "Explore local issues and contribute observations from the places you know.",
  },
  {
    label: "Experts",
    action: "Verify",
    description: "Bring domain authority to knowledge that needs review and context.",
  },
  {
    label: "Organizers",
    action: "Coordinate",
    description: "Move acknowledged issues toward projects and practical action.",
  },
  {
    label: "Administrators",
    action: "Govern",
    description: "Maintain platform visibility, moderation, and operational integrity.",
  },
] as const;

export function LandingParticipation() {
  return (
    <section aria-labelledby="participation-heading" className="border-t">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">Different ways in</p>
            <h2 id="participation-heading" className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Not everyone has the same job here.
            </h2>
          </div>
          <p className="text-muted-foreground max-w-md text-sm leading-6">
            AquaVeda gives different participants different responsibilities. The platform does not flatten
            authority into one giant comment box.
          </p>
        </div>

        <div className="grid divide-y border-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {ROLES.map((role) => (
            <article key={role.label} className="flex min-h-44 flex-col justify-between gap-6 p-5 sm:p-6">
              <div className="space-y-2">
                <h3 className="font-display text-lg font-semibold">{role.label}</h3>
                <p className="font-mono text-[10px] tracking-widest text-primary uppercase">{role.action}</p>
              </div>
              <p className="text-muted-foreground text-sm leading-6">{role.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
