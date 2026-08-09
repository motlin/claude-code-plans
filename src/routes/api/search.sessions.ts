import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { SessionSearchResponse } from "../../lib/api/search";

export const Route = createFileRoute("/api/search/sessions")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url);
        const query = url.searchParams.get("query")?.trim() ?? "";
        if (!query) {
          return Response.json(SessionSearchResponse.parse([]), {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          });
        }

        const { getDb } = await import("../../lib/db");
        const { searchSessionsFromDb } = await import("../../lib/db/queries");
        const { index } = getDb();
        const results = searchSessionsFromDb(index, query);

        return Response.json(SessionSearchResponse.parse(results), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
