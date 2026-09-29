import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/file-refs")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const { resolveFileSearchRoots } = await import("../../lib/config");
        const { getDb } = await import("../../lib/db");
        const { handleFileRefsRequest } = await import("../../lib/file-refs-handler");
        const roots = await resolveFileSearchRoots(getDb().index);
        return handleFileRefsRequest(request, undefined, roots);
      },
    }),
  },
});
