import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { StarredSessionsResponse } from "../../lib/api/sessions";
import {
  invalidSessionStatusResponse,
  parseSessionStatusParam,
} from "../../lib/api/session-status-param";

export const Route = createFileRoute("/api/sessions/starred")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const status = parseSessionStatusParam(new URL(request.url));
        if (status === null) return invalidSessionStatusResponse();
        const { getDb } = await import("../../lib/db");
        const { getStarredSessions, getArchivedSessionIds } = await import("../../lib/db/queries");
        const { toSessionSummaryPayload } = await import("../../lib/session-summary");
        const { getUnseenSessionIds } = await import("../../lib/db/viewed-state");

        const { index } = getDb();
        const unseenIds = getUnseenSessionIds(index);
        const archivedIds = getArchivedSessionIds(index);
        const sessions = getStarredSessions(index, { status }).map((s) =>
          toSessionSummaryPayload(s, true, {
            unseen: unseenIds.has(s.id),
            archived: archivedIds.has(s.id),
          }),
        );

        return Response.json(StarredSessionsResponse.parse(sessions), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
