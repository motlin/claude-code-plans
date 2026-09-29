import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect } from "react";

import { planQueryOptions } from "../../lib/api/plans";
import { stripLeadingTitleHeading } from "../../lib/markdown-utils";
import { toMdSlug } from "../../lib/md-slug";
import { MarkdownView } from "../markdown-view";
import { registerPane } from "./pane-registry";

/** The session's linked plan, rendered as markdown with a link out to its plan page. */
function SessionPlanPane({ planFilename }: { planFilename: string }) {
  const slug = toMdSlug(planFilename);
  const { data: plan, isPending } = useQuery(planQueryOptions(slug));

  return (
    <div data-testid="session-plan-pane" className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 truncate text-body font-semibold text-primary">
          {plan?.title ?? planFilename}
        </h2>
        <Link
          to="/plan/$filename"
          params={{ filename: slug }}
          className="flex shrink-0 items-center gap-1 text-caption text-secondary underline-offset-2 hover:text-primary hover:underline"
        >
          Open plan
          <ExternalLink aria-hidden className="size-3" />
        </Link>
      </div>
      {plan ? (
        <MarkdownView markdown={stripLeadingTitleHeading(plan.markdown)} />
      ) : (
        <p className="py-6 text-center text-body text-muted">
          {isPending ? "Loading plan…" : "This plan could not be found."}
        </p>
      )}
    </div>
  );
}

/** Registers the `plan` pane kind while the session has a linked plan. */
export function useRegisterPlanPane(planFilename: string | undefined): void {
  useEffect(() => {
    if (planFilename === undefined) return undefined;
    return registerPane("plan", {
      title: "Plan",
      render: () => <SessionPlanPane key={planFilename} planFilename={planFilename} />,
    });
  }, [planFilename]);
}
