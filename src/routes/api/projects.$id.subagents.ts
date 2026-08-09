import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { ProjectSubagentsResponse } from "../../lib/api/projects";

export const Route = createFileRoute("/api/projects/$id/subagents")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const { getDb } = await import("../../lib/db");
        const { getSubagentsForProject } = await import("../../lib/db/queries");
        const { toClientSubagent } = await import("../../lib/subagents");

        const { index } = getDb();
        const agents = getSubagentsForProject(index, params.id).map(toClientSubagent);

        return Response.json(ProjectSubagentsResponse.parse(agents), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
