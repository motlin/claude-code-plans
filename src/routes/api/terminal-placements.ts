import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {TerminalPlacementIndexResponse} from "../../lib/api/terminal-placements";

export const Route = createFileRoute("/api/terminal-placements")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const [
					{getDb},
					{terminalPlacementProviders},
					{terminalWritesEnabled},
					{getTerminalPlacements},
					{addViewedStateToTerminalPlacements},
				] = await Promise.all([
					import("../../lib/db"),
					import("../../lib/terminal-host"),
					import("../../lib/config"),
					import("../../lib/terminal-placements"),
					import("../../lib/terminal-placement-viewed-state"),
				]);
				const placements = await getTerminalPlacements(await terminalPlacementProviders());

				return Response.json(
					TerminalPlacementIndexResponse.parse({
						placements: addViewedStateToTerminalPlacements(getDb().index, placements),
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
