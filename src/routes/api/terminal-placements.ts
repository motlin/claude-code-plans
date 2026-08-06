import { createFileRoute } from "@tanstack/react-router";
import { TerminalPlacementIndexResponse } from "../../lib/api/terminal-placements";

function herdrPlacementKey(sessionId: string, terminalId: string): string {
  return `${sessionId}\0${terminalId}`;
}

export const Route = createFileRoute("/api/terminal-placements")({
  server: {
    handlers: {
      GET: async () => {
        const [
          { getDb },
          { addViewedStateToHerdrPanes },
          { herdrWritesEnabled },
          { getTerminalPlacements },
        ] = await Promise.all([
          import("../../lib/db"),
          import("../../lib/herdr/pane-viewed-state"),
          import("../../lib/herdr/prompt"),
          import("../../lib/terminal-placements"),
        ]);
        const placements = await getTerminalPlacements();
        const tmuxPlacements = placements.filter((placement) => placement.provider === "tmux");
        const herdrPlacementsByKey = new Map(
          placements
            .filter((placement) => placement.provider === "herdr")
            .map((placement) => [
              herdrPlacementKey(placement.sessionId, placement.herdrPane.terminalId),
              placement,
            ]),
        );
        const herdrPanes = addViewedStateToHerdrPanes(
          getDb().index,
          [...herdrPlacementsByKey.values()].map((placement) => placement.herdrPane),
        );
        const enrichedHerdrPlacements = herdrPanes.map((pane) => {
          const placement = herdrPlacementsByKey.get(
            herdrPlacementKey(pane.sessionId, pane.terminalId),
          );
          if (!placement) throw new Error("Herdr placement disappeared during enrichment");
          return { ...placement, herdrPane: pane };
        });

        return Response.json(
          TerminalPlacementIndexResponse.parse({
            placements: [...tmuxPlacements, ...enrichedHerdrPlacements],
            writesEnabled: herdrWritesEnabled(),
          }),
          {
            headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
          },
        );
      },
    },
  },
});
