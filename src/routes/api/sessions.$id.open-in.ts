import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { SessionOpenInResponse } from "../../lib/api/sessions";

/** What the row menu's Open in ▸ needs: the session directory and its claude.ai bridge session. */
export const Route = createFileRoute("/api/sessions/$id/open-in")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const [
          { homedir },
          { join },
          { getDb },
          { getSessionDirectory },
          { readBridgeSessionId, resolveSessionFilePath },
        ] = await Promise.all([
          import("node:os"),
          import("node:path"),
          import("../../lib/db"),
          import("../../lib/db/queries"),
          import("../../lib/sessions"),
        ]);
        const { index } = getDb();
        const cwd = getSessionDirectory(index, params.id);
        const resolved = await resolveSessionFilePath(
          join(homedir(), ".claude", "projects"),
          params.id,
        );
        const bridgeSessionId = resolved ? await readBridgeSessionId(resolved.filePath) : null;
        return Response.json(SessionOpenInResponse.parse({ cwd, bridgeSessionId }), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
