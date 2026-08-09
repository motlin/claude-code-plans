import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import {
  SessionViewedStateSchema,
  ViewedStateMutationBodySchema,
} from "../../lib/api/viewed-state";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/sessions/$id/viewed")({
  server: {
    handlers: withMethodNotAllowed({
      PUT: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const [{ getDb }, viewedState] = await Promise.all([
          import("../../lib/db"),
          import("../../lib/db/viewed-state"),
        ]);
        const body = ViewedStateMutationBodySchema.parse(await request.json());
        const { index } = getDb();
        if (body.action === "reviewed") {
          viewedState.markSessionReviewed(index, params.id, body.messageIndex);
        } else {
          viewedState.markSessionUnreviewed(index, params.id, body.messageIndex);
        }
        return Response.json(
          SessionViewedStateSchema.parse(
            viewedState.getSessionViewedState(index, params.id, body.messageIndex),
          ),
          { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } },
        );
      },
    }),
  },
});
