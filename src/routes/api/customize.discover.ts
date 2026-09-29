import { createFileRoute } from "@tanstack/react-router";
import { DiscoverCatalogResponse } from "../../lib/api/customize";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/customize/discover")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const { readDiscoverCatalog } = await import("../../lib/customize/discover");
        const catalog = await readDiscoverCatalog();
        return Response.json(DiscoverCatalogResponse.parse(catalog), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    }),
  },
});
