import { createFileRoute } from "@tanstack/react-router";
import { McpServerDetailResponse } from "../../lib/api/customize";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { fromConnectorSlug } from "../../lib/customize/mcp-tool-permissions";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

export const Route = createFileRoute("/api/customize/mcp-servers/$serverSlug")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async ({ params }: { params: { serverSlug: string } }) => {
        const id = fromConnectorSlug(params.serverSlug);
        const { getDb } = await import("../../lib/db");
        const { listMcpToolNames } = await import("../../lib/db/queries");
        const { readMcpServerDetail } = await import("../../lib/customize/mcp");
        const detail =
          id === null
            ? null
            : await readMcpServerDetail(id, { toolNames: listMcpToolNames(getDb().index) });
        if (detail === null) {
          return Response.json(
            { error: "Connector not found" },
            { status: 404, headers: { "Cache-Control": PRIVATE_NO_CACHE } },
          );
        }
        return Response.json(McpServerDetailResponse.parse(detail), {
          headers: { "Cache-Control": PRIVATE_NO_CACHE },
        });
      },
    }),
  },
});
