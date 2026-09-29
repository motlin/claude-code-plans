import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/sessions/$id/diff/scopes")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const { handleSessionDiffScopesRequest } = await import("../../lib/session-diff-handler");
        return handleSessionDiffScopesRequest(params.id);
      },
    }),
  },
});
