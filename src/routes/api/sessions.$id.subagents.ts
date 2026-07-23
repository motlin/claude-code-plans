import { createFileRoute } from "@tanstack/react-router";
import { SessionSubagentsResponse } from "../../lib/api/sessions";

export const Route = createFileRoute("/api/sessions/$id/subagents")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const { getDb } = await import("../../lib/db");
        const { getSubagentsForSession } = await import("../../lib/db/queries");
        const { toClientSubagent } = await import("../../lib/subagents");

        const { index } = getDb();
        const agents = getSubagentsForSession(index, params.id).map(toClientSubagent);

        return Response.json(SessionSubagentsResponse.parse(agents), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
