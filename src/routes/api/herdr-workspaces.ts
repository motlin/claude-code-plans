import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { HerdrWorkspaceIndexResponse } from "../../lib/api/herdr-workspaces";

export const Route = createFileRoute("/api/herdr-workspaces")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { getHerdrWorkspaces } = await import("../../lib/herdr/workspaces");
        return Response.json(
          HerdrWorkspaceIndexResponse.parse({ workspaces: await getHerdrWorkspaces() }),
          { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
        );
      },
    }),
  },
});
