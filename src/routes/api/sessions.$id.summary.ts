import { createFileRoute } from "@tanstack/react-router";
import { SummaryMutationResponse } from "../../lib/api/sessions";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/sessions/$id/summary")({
  server: {
    handlers: {
      POST: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { getDb } = await import("../../lib/db");
        const { generateSummary } = await import("../../lib/summaries");
        const { summaries } = getDb();
        const summary = await generateSummary(summaries, params.id);
        return Response.json(SummaryMutationResponse.parse({ summary }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
