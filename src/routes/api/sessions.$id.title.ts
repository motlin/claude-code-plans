import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { RenameSessionBody, RenameSessionResponse } from "../../lib/api/sessions";
import { rejectCrossSite } from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/sessions/$id/title")({
  server: {
    handlers: withMethodNotAllowed({
      PUT: async ({ params, request }: { params: { id: string }; request: Request }) => {
        const rejection = rejectCrossSite(request);
        if (rejection) return rejection;

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const body = RenameSessionBody.safeParse(json);
        if (!body.success) {
          return Response.json({ error: body.error.message }, { status: 400 });
        }

        const [{ homedir }, { join }, { getDb }, { renameSession }, { broadcastTyped }] =
          await Promise.all([
            import("node:os"),
            import("node:path"),
            import("../../lib/db"),
            import("../../lib/session-rename"),
            import("../../lib/sse-broadcast"),
          ]);
        const renamed = await renameSession({
          db: getDb().index,
          claudeDir: join(homedir(), ".claude"),
          sessionId: params.id,
          title: body.data.title,
          broadcast: broadcastTyped,
        });
        if (!renamed) return Response.json({ error: "Session not found" }, { status: 404 });

        return Response.json(RenameSessionResponse.parse(renamed), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
