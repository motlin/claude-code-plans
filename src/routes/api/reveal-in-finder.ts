import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/reveal-in-finder")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const { handleRevealInFinder } = await import("../../lib/open-in-finder");
        return handleRevealInFinder(request);
      },
    }),
  },
});
