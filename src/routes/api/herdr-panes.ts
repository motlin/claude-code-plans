import { createFileRoute } from "@tanstack/react-router";
import { withMethodNotAllowed } from "../../lib/api/method-not-allowed";
import { HerdrPaneIndexResponse } from "../../lib/api/herdr";

export const Route = createFileRoute("/api/herdr-panes")({
  server: {
    handlers: withMethodNotAllowed({
      GET: async () => {
        const [
          { getDb },
          { getHerdrPanes },
          { addViewedStateToHerdrPanes },
          { herdrWritesEnabled },
        ] = await Promise.all([
          import("../../lib/db"),
          import("../../lib/herdr/panes"),
          import("../../lib/herdr/pane-viewed-state"),
          import("../../lib/herdr/prompt"),
        ]);
        const panes = addViewedStateToHerdrPanes(getDb().index, await getHerdrPanes());
        return Response.json(
          HerdrPaneIndexResponse.parse({ panes, writesEnabled: herdrWritesEnabled() }),
          {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          },
        );
      },
    }),
  },
});
