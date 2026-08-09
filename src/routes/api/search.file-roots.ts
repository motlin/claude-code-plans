import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { FileSearchRootsResponse } from "../../lib/api/search";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

export function fileSearchRootsResponse(roots: string[]): Response {
  return Response.json(FileSearchRootsResponse.parse({ roots }), {
    headers: { "Cache-Control": PRIVATE_NO_CACHE },
  });
}

export const Route = createFileRoute("/api/search/file-roots")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { resolveFileSearchRoots } = await import("../../lib/config");
        const { getDb } = await import("../../lib/db");
        return fileSearchRootsResponse(await resolveFileSearchRoots(getDb().index));
      },
    }),
  },
});
