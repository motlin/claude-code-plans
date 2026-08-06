import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/herdr/interrupt")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { handleHerdrInterrupt } = await import("../../lib/herdr/interrupt");
        return handleHerdrInterrupt(request);
      },
    },
  },
});
