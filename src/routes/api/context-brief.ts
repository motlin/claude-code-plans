import { createFileRoute } from "@tanstack/react-router";
import type { ContextBriefInput } from "../../lib/context-brief";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";
const CONTEXT_BRIEF_TASK_QUERY_LIMIT = 15;
const CONTEXT_BRIEF_PLAN_QUERY_LIMIT = 5;

export interface ContextBriefDependencies {
  load(cwd: string): ContextBriefInput | null;
  build(input: ContextBriefInput): string;
}

function textResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Cache-Control": PRIVATE_NO_CACHE,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export function handleContextBriefRequest(
  request: Request,
  dependencies: ContextBriefDependencies,
): Response {
  try {
    const cwd = new URL(request.url).searchParams.get("cwd");
    if (cwd === null || cwd.length === 0) return textResponse("");

    const input = dependencies.load(cwd);
    return textResponse(input === null ? "" : dependencies.build(input));
  } catch {
    return textResponse("");
  }
}

export const Route = createFileRoute("/api/context-brief")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const [{ getDb }, queries, contextBrief] = await Promise.all([
            import("../../lib/db"),
            import("../../lib/db/queries"),
            import("../../lib/context-brief"),
          ]);
          const { index } = getDb();

          return handleContextBriefRequest(request, {
            load: (cwd) => {
              const project = queries.getContextBriefProject(index, cwd);
              if (project === null) return null;

              return {
                projectName: project.name,
                openTaskTitles: queries
                  .getOpenTasksForProject(index, project.id, CONTEXT_BRIEF_TASK_QUERY_LIMIT)
                  .map((task) => task.subject),
                recentPlanTitles: queries
                  .getRecentPlansForProject(index, project.id, CONTEXT_BRIEF_PLAN_QUERY_LIMIT)
                  .map((plan) => plan.title),
                decisionTitles: queries
                  .getMemoriesForProject(index, project.id)
                  .map((memory) => memory.title),
              };
            },
            build: contextBrief.buildContextBrief,
          });
        } catch {
          return textResponse("");
        }
      },
    },
  },
});
