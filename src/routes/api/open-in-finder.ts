import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/open-in-finder")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const { handleOpenInFinder } = await import("../../lib/open-in-finder");
        return handleOpenInFinder(request);
      },
    }),
  },
});
