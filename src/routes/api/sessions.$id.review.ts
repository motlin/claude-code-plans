import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/sessions/$id/review")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { handleCreateReviewRequest } = await import("../../lib/reviews");
        return handleCreateReviewRequest(params.id);
      },
    }),
  },
});
