import { createFileRoute } from "@tanstack/react-router";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/sessions/$id/review")({
  server: {
    handlers: {
      POST: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { handleCreateReviewRequest } = await import("../../lib/reviews");
        return handleCreateReviewRequest(params.id);
      },
    },
  },
});
