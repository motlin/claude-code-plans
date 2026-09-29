import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/artifacts/$id/source")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const { getDb } = await import("../../lib/db");
        const { handleArtifactSourceRequest } = await import("../../lib/artifact-source");
        return handleArtifactSourceRequest(getDb().index, params.id);
      },
    }),
  },
});
