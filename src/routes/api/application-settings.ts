import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/application-settings")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { handleGetApplicationSettings } =
          await import("../../lib/application-settings-handler");
        return handleGetApplicationSettings();
      },
      PUT: async ({ request }: { request: Request }) => {
        const { handlePutApplicationSettings } =
          await import("../../lib/application-settings-handler");
        return handlePutApplicationSettings(request);
      },
    }),
  },
});
