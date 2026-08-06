import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/image")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { handleImageRequest } = await import("../../lib/image-serving");
        return handleImageRequest(request);
      },
    },
  },
});
