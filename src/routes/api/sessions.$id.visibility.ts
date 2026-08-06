import { createFileRoute } from "@tanstack/react-router";
import { SessionVisibilityBodySchema } from "../../lib/api/viewed-state";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/sessions/$id/visibility")({
  server: {
    handlers: {
      PUT: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        const { setSessionVisibility } = await import("../../lib/session-visibility");
        const body = SessionVisibilityBodySchema.parse(await request.json());
        setSessionVisibility(body.clientId, params.id, body.visible);
        return new Response(null, { status: 204 });
      },
    },
  },
});
