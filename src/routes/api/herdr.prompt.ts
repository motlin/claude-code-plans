import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/prompt")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const { handleHerdrPrompt } = await import("../../lib/herdr/prompt");
        return handleHerdrPrompt(request);
      },
    }),
  },
});
