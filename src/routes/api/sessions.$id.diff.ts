import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

/**
 * The session's changes for the Changes pane. File paths travel in the query
 * string (`&file=<path>`) because vp dev 404s dotted URL path segments.
 */
export const Route = createFileRoute("/api/sessions/$id/diff")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const { handleSessionDiffRequest } = await import("../../lib/session-diff-handler");
        return handleSessionDiffRequest(params.id, new URL(request.url).searchParams);
      },
    }),
  },
});
