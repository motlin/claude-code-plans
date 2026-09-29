import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { HomeStatsResponse } from "../../lib/api/home-stats";

export const Route = createFileRoute("/api/home-stats")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { getDb } = await import("../../lib/db");
        const { getHomeStatsDays } = await import("../../lib/db/usage-index");
        const { localDateKey, mergeStatsCacheTokens } = await import("../../lib/home-stats");
        const { readStatsCacheTokens } = await import("../../lib/stats-cache");

        const today = localDateKey(new Date());
        const days = mergeStatsCacheTokens(
          getHomeStatsDays(getDb().index),
          await readStatsCacheTokens(),
          today,
        );

        return Response.json(HomeStatsResponse.parse({ today, days }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
