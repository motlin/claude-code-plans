import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { ActiveSessionListResponse } from "../../lib/api/sessions";

export const Route = createFileRoute("/api/sessions/active")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ request }: { request: Request }) => {
        const { scanActiveSessions } = await import("../../lib/active-sessions");
        const url = new URL(request.url);
        const activeTimeoutMsParam = url.searchParams.get("activeTimeoutMs");
        const activeTimeoutMs = activeTimeoutMsParam ? Number(activeTimeoutMsParam) : undefined;
        const sessions = await scanActiveSessions(activeTimeoutMs);
        return Response.json(ActiveSessionListResponse.parse(sessions), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
