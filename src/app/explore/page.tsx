import { RequireAuth } from "@/components/auth/require-auth";
import { IssueReportForm } from "@/components/issues/issue-report-form";

export default function ExplorePage() {
    return (
        <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <div className="space-y-2">
                <p className="text-muted-foreground font-mono text-xs tracking-widest uppercase">
                    Explore
                </p>

                <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                    Report an issue
                </h1>

                <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
                    Help document an issue by providing a short description and
                    its affected location.
                </p>
            </div>

            <div className="mt-8">
                <RequireAuth>
                    <IssueReportForm />
                </RequireAuth>
            </div>
        </main>
    );
}