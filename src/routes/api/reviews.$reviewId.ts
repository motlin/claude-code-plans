import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/reviews/$reviewId")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { reviewId: string } }) => {
        const { handleGetReviewRequest } = await import("../../lib/reviews");
        return handleGetReviewRequest(params.reviewId);
      },
    },
  },
});
