import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/reviews/$reviewId")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { reviewId: string } }) => {
        const { handleGetReviewRequest } = await import("../../lib/reviews");
        return handleGetReviewRequest(params.reviewId);
      },
    }),
  },
});
