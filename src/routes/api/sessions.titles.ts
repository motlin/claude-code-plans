import { createFileRoute } from "@tanstack/react-router";
import { SessionTitlesResponse } from "../../lib/api/sessions";

export const Route = createFileRoute("/api/sessions/titles")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { getDb } = await import("../../lib/db");
        const { getSessionTitlesByIds } = await import("../../lib/db/queries");

        const url = new URL(request.url);
        const ids = (url.searchParams.get("ids") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const { index } = getDb();
        const titles = getSessionTitlesByIds(index, ids);

        return Response.json(SessionTitlesResponse.parse({ titles }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
