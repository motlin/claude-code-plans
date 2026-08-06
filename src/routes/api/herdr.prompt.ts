import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/herdr/prompt")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { handleHerdrPrompt } = await import("../../lib/herdr/prompt");
        return handleHerdrPrompt(request);
      },
    },
  },
});
