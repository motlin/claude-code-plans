import { createFileRoute } from "@tanstack/react-router";
import { ProjectPlanListResponse } from "../../lib/api/projects";

export const Route = createFileRoute("/api/projects/$id/plans")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const { stat } = await import("node:fs/promises");
        const { getDb } = await import("../../lib/db");
        const { getProjectDetailFromDb } = await import("../../lib/db/queries");
        const { extractTitle } = await import("../../lib/markdown-utils.server");

        const plansDir = join(homedir(), ".claude", "plans");
        const { index } = getDb();
        const detail = getProjectDetailFromDb(index, params.id);

        if (!detail) {
          return Response.json(ProjectPlanListResponse.parse([]), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }

        const uniqueLinks = [...new Map(detail.planLinks.map((p) => [p.planFilename, p])).values()];

        const plans = await Promise.all(
          uniqueLinks.map(async (p) => {
            const planPath = join(plansDir, p.planFilename);
            const [statResult, title] = await Promise.all([
              stat(planPath).catch(() => null),
              extractTitle(planPath, p.planFilename),
            ]);
            return {
              filename: p.planFilename,
              title,
              mtime: statResult ? statResult.mtime.toISOString() : null,
              sessionId: p.sessionId,
            };
          }),
        );

        plans.sort((a, b) => {
          if (a.mtime && b.mtime) return new Date(b.mtime).getTime() - new Date(a.mtime).getTime();
          if (a.mtime) return -1;
          if (b.mtime) return 1;
          return a.filename.localeCompare(b.filename);
        });

        return Response.json(ProjectPlanListResponse.parse(plans), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
