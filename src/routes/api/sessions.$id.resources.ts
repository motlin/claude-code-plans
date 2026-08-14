import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { SessionResourcesResponse } from "../../lib/api/sessions";

/**
 * The session's complete file and link inventory, scanned from the whole JSONL.
 *
 * The transcript endpoint deliberately serves only a window, which is why the
 * Files and Links pills read as floors (`12+`) until a drawer is opened. This
 * is the answer to that: one full pass, asked for only when a reader actually
 * wants the inventory.
 */
export const Route = createFileRoute("/api/sessions/$id/resources")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { id: string } }) => {
        const { getDb } = await import("../../lib/db");
        const { readSessionResources } = await import("../../lib/session-resource-scan");
        const { homedir } = await import("node:os");

        const { index } = getDb();
        const resources = readSessionResources(index, params.id, homedir());

        return Response.json(SessionResourcesResponse.parse(resources), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
