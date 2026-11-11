import { ShieldCheck, Sparkles, Users } from "lucide-react";

const PRINCIPLES = [
  {
    icon: Users,
    title: "Community contributes",
    description: "People surface what they observe and make local issues visible.",
  },
  {
    icon: ShieldCheck,
    title: "Experts verify",
    description: "Domain expertise helps distinguish reviewed knowledge from community reports.",
  },
  {
    icon: Sparkles,
    title: "AI assists",
    description: "AI can help people navigate information, but it does not replace expert judgment or verified knowledge.",
  },
] as const;

export function LandingTrust() {
  return (
    <section aria-labelledby="trust-heading" className="border-t bg-muted/40">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.65fr_1.35fr]">
          <div className="space-y-4">
            <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">Trust model</p>
            <h2 id="trust-heading" className="font-display max-w-sm text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Useful information needs more than an answer box.
            </h2>
            <p className="text-muted-foreground max-w-md text-sm leading-7">
              AquaVeda keeps community reporting, expert verification, and AI assistance distinguishable so
              visitors can understand what they are looking at.
            </p>
          </div>

          <div className="grid divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {PRINCIPLES.map(({ icon: Icon, title, description }) => (
              <article key={title} className="space-y-4 p-5 sm:p-6">
                <Icon aria-hidden="true" className="size-5 text-primary" />
                <div className="space-y-2">
                  <h3 className="font-display text-base font-semibold">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-6">{description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
