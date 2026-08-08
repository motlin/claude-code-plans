import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/application-settings")({
  server: {
    handlers: {
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
    },
  },
});
