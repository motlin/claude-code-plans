import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { reviewQueryOptions } from "../lib/api/reviews";
import { openReviewInChanges } from "../lib/changes-review";

/**
 * A deep link to a working-copy review: opens the review's session with the
 * Changes pane on the Uncommitted scope, where the findings render inline.
 */
export const Route = createFileRoute("/review/$reviewId")({
  component: ReviewDeepLink,
  loader: ({ context: { queryClient }, params }) =>
    queryClient.ensureQueryData(reviewQueryOptions(params.reviewId)),
  head: () => ({ meta: [{ title: "Working-copy review" }] }),
});

function ReviewDeepLink() {
  const { reviewId } = Route.useParams();
  const { data: review } = useSuspenseQuery(reviewQueryOptions(reviewId));
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ ...openReviewInChanges(review.sessionId, reviewId), replace: true });
  }, [navigate, review.sessionId, reviewId]);

  return <p className="px-6 py-6 text-body text-ink-muted">Opening review findings…</p>;
}
