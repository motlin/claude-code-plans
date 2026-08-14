import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { plansQueryOptions, type PlanListItem } from "../lib/api/plans";
import { toMdSlug } from "../lib/md-slug";

// Keep react-query's select result stable and share one filename Set across transcript links.
let memoSource: PlanListItem[] | undefined;
let memoSet = new Set<string>();

export function selectPlanFilenames(plans: PlanListItem[]): Set<string> {
  if (plans !== memoSource) {
    memoSource = plans;
    memoSet = new Set(plans.map((plan) => plan.filename));
  }
  return memoSet;
}

export function PlanLink({ planFilePath }: { planFilePath: string }) {
  const { data: known } = useQuery({
    ...plansQueryOptions(),
    select: selectPlanFilenames,
  });
  const filename = planFilePath.split("/").pop();
  if (!filename) return null;

  // The database-backed check can briefly lag disk, so keep cold-cache and missing links clickable.
  const exists = known?.has(filename) ?? true;

  return (
    <Link
      to="/plan/$filename"
      params={{ filename: toMdSlug(filename) }}
      title={exists ? planFilePath : `${planFilePath} — no plan file on disk yet`}
      className={`inline-flex items-center gap-1 font-mono max-w-xs ${
        exists
          ? "text-accent-500 hover:underline"
          : "text-t6 opacity-60 underline decoration-dotted hover:decoration-solid"
      }`}
      {...(exists ? {} : { "data-plan-missing": "true" })}
    >
      {!exists && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="truncate">{filename}</span>
    </Link>
  );
}
