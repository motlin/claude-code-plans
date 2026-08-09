import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { ProjectBranchListResponse } from "../../lib/api/projects";

export const Route = createFileRoute("/api/projects/$id/branches")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const { getDb } = await import("../../lib/db");
        const { listBranchesForProject } = await import("../../lib/db/queries");

        const { index } = getDb();
        const branches = listBranchesForProject(index, params.id);

        const serialized = branches.map((b) => ({
          branch: b.branch,
          sessionCount: b.sessionCount,
          lastActivity: new Date(b.lastActivity).toISOString(),
        }));

        return Response.json(ProjectBranchListResponse.parse(serialized), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
