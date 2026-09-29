import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/customize/settings-toggles")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { handleSettingsToggleGet } = await import("../../lib/customize/settings-toggles");
        return handleSettingsToggleGet();
      },
      POST: async ({ request }: { request: Request }) => {
        const { handleSettingsTogglePost } = await import("../../lib/customize/settings-toggles");
        return handleSettingsTogglePost(request);
      },
    }),
  },
});
