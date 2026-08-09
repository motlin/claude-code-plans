import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/reviews/$reviewId/findings")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ params, request }: { params: { reviewId: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { handleReplaceReviewFindingsRequest } = await import("../../lib/reviews");
        return handleReplaceReviewFindingsRequest(request, params.reviewId);
      },
    }),
  },
});
