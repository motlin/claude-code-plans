import { createFileRoute } from "@tanstack/react-router";
import { RecentSessionsResponse } from "../../lib/api/sessions";

function parseCursor(raw: string | null): { mtimeMs: number; id: string } | undefined {
  if (!raw) return undefined;
  const idx = raw.indexOf(":");
  if (idx <= 0) return undefined;
  const mtimeMs = Number(raw.slice(0, idx));
  const id = raw.slice(idx + 1);
  if (!Number.isFinite(mtimeMs) || !id) return undefined;
  return { mtimeMs, id };
}

function clampLimit(raw: string | null): number {
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, n));
}

export const Route = createFileRoute("/api/sessions/recent")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { getDb } = await import("../../lib/db");
        const { listRecentSessionsFromDb, getStarredSessionIds } =
          await import("../../lib/db/queries");
        const { toSessionSummaryPayload } = await import("../../lib/session-summary");

        const url = new URL(request.url);
        const limit = clampLimit(url.searchParams.get("limit"));
        const before = parseCursor(url.searchParams.get("cursor"));

        const { index } = getDb();
        const page = listRecentSessionsFromDb(index, before ? { limit, before } : { limit });
        const starredIds = getStarredSessionIds(index);
        const sessions = page.sessions.map((s) => toSessionSummaryPayload(s, starredIds.has(s.id)));
        const nextCursor = page.nextCursor
          ? `${page.nextCursor.mtimeMs}:${page.nextCursor.id}`
          : null;

        return Response.json(RecentSessionsResponse.parse({ sessions, nextCursor }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
