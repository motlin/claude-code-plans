import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {TerminalPlacementIndexResponse} from "../../lib/api/terminal-placements";

function herdrPlacementKey(sessionId: string, terminalId: string): string {
	return `${sessionId}\0${terminalId}`;
}

export const Route = createFileRoute("/api/terminal-placements")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const [
					{getDb},
					{addViewedStateToPanes, terminalPlacementProviders},
					{terminalWritesEnabled},
					{getTerminalPlacements},
				] = await Promise.all([
					import("../../lib/db"),
					import("../../lib/terminal-host"),
					import("../../lib/config"),
					import("../../lib/terminal-placements"),
				]);
				const placements = await getTerminalPlacements(await terminalPlacementProviders());
				const tmuxPlacements = placements.filter((placement) => placement.provider === "tmux");
				const herdrPlacementsByKey = new Map(
					placements
						.filter((placement) => placement.provider === "herdr")
						.map((placement) => [
							herdrPlacementKey(placement.sessionId, placement.herdrPane.terminalId),
							placement,
						]),
				);
				const herdrPanes = addViewedStateToPanes(
					getDb().index,
					[...herdrPlacementsByKey.values()].map((placement) => placement.herdrPane),
				);
				const enrichedHerdrPlacements = herdrPanes.map((pane) => {
					const placement = herdrPlacementsByKey.get(herdrPlacementKey(pane.sessionId, pane.terminalId));
					if (!placement) throw new Error("Herdr placement disappeared during enrichment");
					return {...placement, herdrPane: pane};
				});

				return Response.json(
					TerminalPlacementIndexResponse.parse({
						placements: [...tmuxPlacements, ...enrichedHerdrPlacements],
						writesEnabled: terminalWritesEnabled(),
					}),
					{
						headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
					},
				);
			},
		}),
	},
});
