import { createFileRoute } from "@tanstack/react-router";
import { HerdrPaneListResponse } from "../../lib/api/herdr";

export const Route = createFileRoute("/api/herdr-panes")({
  server: {
    handlers: {
      GET: async () => {
        const { getHerdrPanes } = await import("../../lib/herdr/panes");
        const panes = await getHerdrPanes();
        return Response.json(HerdrPaneListResponse.parse(panes), {
          headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
        });
      },
    },
  },
});
