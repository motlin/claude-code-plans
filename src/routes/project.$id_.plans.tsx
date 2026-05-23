import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { projectDetailQueryOptions, projectPlansQueryOptions } from "../lib/api/projects";
import { DetailTopBar, pillStyles } from "../components/detail-top-bar";
import { DebugLink } from "../components/debug-link";

export const Route = createFileRoute("/project/$id_/plans")({
  component: ProjectPlansPage,
  loader: async ({ context: { queryClient }, params }) => {
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(projectDetailQueryOptions(params.id)),
      queryClient.ensureQueryData(projectPlansQueryOptions(params.id)),
    ]);
    return detail;
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.name} plans` : "Project Not Found" }],
  }),
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProjectPlansPage() {
  const { id } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectDetailQueryOptions(id));
  const { data: plans } = useSuspenseQuery(projectPlansQueryOptions(id));

  if (!project) {
    return (
      <div>
        <DetailTopBar>
          <Link to="/projects" className={pillStyles.primary}>
            <ArrowLeft className="h-3.5 w-3.5" />
            All Projects
          </Link>
        </DetailTopBar>
        <h1 className="mt-4 text-lg font-semibold">Project Not Found</h1>
      </div>
    );
  }

  const count = plans.length;

  return (
    <div>
      <DetailTopBar>
        <Link to="/project/$id" params={{ id: project.id }} className={pillStyles.primary}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {project.name}
        </Link>
      </DetailTopBar>

      <h1 className="text-lg font-semibold">{project.name} plans</h1>
      <p className="mt-0.5 text-xs text-text-500">
        {count} {count === 1 ? "plan" : "plans"}
      </p>

      {count === 0 ? (
        <p className="mt-4 text-text-500">No plans linked to this project.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {plans.map((plan) => (
            <li key={plan.filename} className="relative">
              <Link
                to="/plan/$filename"
                params={{ filename: plan.filename }}
                className="flex items-center justify-between rounded-md border border-border-300/15 px-4 py-3 transition-colors hover:bg-bg-200/50"
              >
                <span className="text-sm font-medium">{plan.title}</span>
                {plan.mtime && (
                  <span className="ml-4 shrink-0 text-xs text-text-500">
                    {formatDate(plan.mtime)}
                  </span>
                )}
              </Link>
              <DebugLink
                kind="plan"
                relativePath={plan.filename}
                className="absolute right-1 top-1"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
