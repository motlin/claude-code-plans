import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { SessionDevServersResponse } from "../../lib/api/sessions";

/**
 * Loopback dev servers for the Links pane's "Open dev server" links: the
 * project's `.claude/launch.json` plus URLs in the latest Bash results, each
 * probed with a loopback-only HEAD.
 */
export const Route = createFileRoute("/api/sessions/$id/dev-servers")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const [
          { getDb },
          { getSessionDirectory },
          { transcriptFilePath },
          { readSessionDevServers },
        ] = await Promise.all([
          import("../../lib/db"),
          import("../../lib/db/queries"),
          import("../../lib/structured-transcript"),
          import("../../lib/session-dev-servers"),
        ]);
        const { index } = getDb();
        const servers = await readSessionDevServers(
          transcriptFilePath(index, params.id),
          getSessionDirectory(index, params.id),
        );
        return Response.json(SessionDevServersResponse.parse({ servers }), {
          headers: { "Cache-Control": "private, no-store" },
        });
      },
    }),
  },
});
