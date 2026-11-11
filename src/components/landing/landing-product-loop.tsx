const STEPS = [
  {
    number: "01",
    title: "Discover",
    description: "Explore public environmental issues and see where attention is needed.",
  },
  {
    number: "02",
    title: "Understand",
    description: "Use reviewed knowledge to put an issue in context before deciding what to do.",
  },
  {
    number: "03",
    title: "Contribute",
    description: "Report what you observe or add knowledge through the existing participation paths.",
  },
  {
    number: "04",
    title: "Act",
    description: "Turn acknowledged issues into projects and coordinated action.",
  },
] as const;

export function LandingProductLoop() {
  return (
    <section aria-labelledby="product-loop-heading" className="border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.7fr_1.3fr] lg:py-20">
        <div className="space-y-4">
          <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">The product loop</p>
          <h2 id="product-loop-heading" className="font-display max-w-md text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            From a signal on the map to something people can act on.
          </h2>
          <p className="text-muted-foreground max-w-md text-sm leading-7">
            AquaVeda connects discovery, trusted context, community contribution, and action without pretending
            those are the same thing.
          </p>
        </div>

        <ol className="grid gap-0 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className={index < 2 ? "border-b sm:border-b sm:border-r" : "border-b last:border-b-0 sm:border-b-0"}
            >
              <div className="flex min-h-48 flex-col justify-between gap-8 p-5 sm:p-6">
                <span className="font-mono text-xs text-primary">{step.number}</span>
                <div className="space-y-2">
                  <h3 className="font-display text-xl font-semibold">{step.title}</h3>
                  <p className="text-muted-foreground text-sm leading-6">{step.description}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
