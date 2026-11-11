import Link from "next/link";

import { LandingMapPreview } from "@/components/landing/landing-map-preview";
import { LandingParticipation } from "@/components/landing/landing-participation";
import { LandingProductLoop } from "@/components/landing/landing-product-loop";
import { LandingTrust } from "@/components/landing/landing-trust";
import { ReportIssueButton } from "@/components/issues/report-issue-button";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div>
      <section className="border-b">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-14 lg:py-24">
          <div className="space-y-7">
            <div className="space-y-4">
              <p className="font-mono text-[10px] tracking-[0.2em] text-primary uppercase">
                Civic intelligence · water first
              </p>
              <h1 className="font-display max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Understand what is happening. Help decide what happens next.
              </h1>
              <p className="text-muted-foreground max-w-xl text-base leading-7 sm:text-lg">
                AquaVeda brings environmental issues, trusted knowledge, community reporting, and action into
                one place. Water is the flagship domain, not the ceiling.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/explore">Explore what is happening</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/learn">Learn how AquaVeda works</Link>
              </Button>
            </div>

            <p className="text-muted-foreground max-w-lg text-xs leading-5">
              Explore public issues without an account. Reporting and other contribution paths use the existing
              sign-in boundary.
            </p>
          </div>

          <LandingMapPreview />
        </div>
      </section>

      <LandingProductLoop />
      <LandingTrust />
      <LandingParticipation />

      <section aria-labelledby="start-heading" className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8 lg:flex lg:items-end lg:justify-between lg:gap-10">
            <div className="max-w-2xl space-y-3">
              <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">Start here</p>
              <h2 id="start-heading" className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Start with what you can see. Contribute when you are ready.
              </h2>
              <p className="text-muted-foreground text-sm leading-7">
                Explore public reports, read reviewed knowledge, or report something you have observed. The
                platform keeps those paths connected without pretending they are interchangeable.
              </p>
            </div>

            <div className="mt-6 flex shrink-0 flex-wrap gap-3 lg:mt-0">
              <Button asChild>
                <Link href="/explore">Explore</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/learn">Learn</Link>
              </Button>
              <ReportIssueButton />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
