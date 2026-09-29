import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/permission")({
  server: {
    handlers: withMethodNotAllowed({
      POST: async ({ request }: { request: Request }) => {
        const { handleHerdrPermission } = await import("../../lib/herdr/permission");
        return handleHerdrPermission(request);
      },
    }),
  },
});
