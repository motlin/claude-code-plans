import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { plansQueryOptions } from "../lib/api/plans";
import { toMdSlug } from "../lib/md-slug";
import { DebugLink } from "../components/debug-link";
import { ListPageHeader } from "../components/list-page-header";

export const Route = createFileRoute("/plans")({
  component: PlansPage,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(plansQueryOptions()),
  head: () => ({
    meta: [{ title: "Claude Plans" }],
  }),
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function PlansPage() {
  const { data: plans } = useSuspenseQuery(plansQueryOptions());
  const now = Date.now();
  const count = plans.length;

  return (
    <div>
      <ListPageHeader title="Claude Plans" count={count} itemLabel="plan" />

      {count === 0 ? (
        <p className="mt-4 text-text-500">No plans found.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {plans.map((plan, index) => {
            const ageHours = (now - new Date(plan.mtime).getTime()) / 3600000;
            return (
              <li key={plan.filename} className="relative">
                <Link
                  to="/plan/$filename"
                  params={{ filename: toMdSlug(plan.filename) }}
                  preload={index < 2 ? "render" : "intent"}
                  className="flex items-center justify-between rounded-md border border-border-300/15 px-4 py-3 transition-colors hover:bg-bg-200/50"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {plan.title}
                    {ageHours < 1 && (
                      <span className="rounded-full bg-success-900 px-2 py-0.5 text-xs font-semibold text-success-000">
                        NEW
                      </span>
                    )}
                  </span>
                  <span className="ml-4 shrink-0 text-xs text-text-500">
                    {formatDate(plan.mtime)}
                  </span>
                </Link>
                <DebugLink
                  kind="plan"
                  relativePath={plan.filename}
                  className="absolute right-1 top-1"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
