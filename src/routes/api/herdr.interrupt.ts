import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/interrupt")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const { handleHerdrInterrupt } = await import("../../lib/herdr/interrupt");
        return handleHerdrInterrupt(request);
      },
    }),
  },
});
