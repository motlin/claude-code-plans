import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { StarredSessionsResponse } from "../../lib/api/sessions";

export const Route = createFileRoute("/api/sessions/starred")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { getDb } = await import("../../lib/db");
        const { getStarredSessions } = await import("../../lib/db/queries");
        const { toSessionSummaryPayload } = await import("../../lib/session-summary");

        const { index } = getDb();
        const sessions = getStarredSessions(index).map((s) => toSessionSummaryPayload(s, true));

        return Response.json(StarredSessionsResponse.parse(sessions), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
