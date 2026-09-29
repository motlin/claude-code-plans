import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { GroupedSessionsResponse } from "../../lib/api/sessions";
import {
  invalidSessionStatusResponse,
  parseSessionStatusParam,
} from "../../lib/api/session-status-param";

function clampPerProject(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(50, n));
}

export const Route = createFileRoute("/api/sessions/grouped")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const { getDb } = await import("../../lib/db");
        const { listSessionGroupsFromDb, getArchivedSessionIds } =
          await import("../../lib/db/queries");
        const { toSessionSummaryPayload } = await import("../../lib/session-summary");
        const { getUnseenSessionIds } = await import("../../lib/db/viewed-state");

        const url = new URL(request.url);
        const perProject = clampPerProject(url.searchParams.get("perProject"));
        const status = parseSessionStatusParam(url);
        if (status === null) return invalidSessionStatusResponse();

        const { index } = getDb();
        const groups = listSessionGroupsFromDb(
          index,
          perProject ? { perProject, status } : { status },
        );
        const unseenIds = getUnseenSessionIds(index);
        const archivedIds = getArchivedSessionIds(index);
        const serialized = groups.map((g) => ({
          project: g.project,
          projectName: g.projectName,
          sessionCount: g.sessionCount,
          sessions: g.sessions.map((s) =>
            toSessionSummaryPayload(s, {
              unseen: unseenIds.has(s.id),
              archived: archivedIds.has(s.id),
            }),
          ),
        }));

        return Response.json(GroupedSessionsResponse.parse(serialized), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
