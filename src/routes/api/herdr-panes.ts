import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {HerdrPaneIndexResponse} from "../../lib/api/herdr";

export const Route = createFileRoute("/api/herdr-panes")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const [{getDb}, {addViewedStateToPanes, getTerminalHost}, {terminalWritesEnabled}] = await Promise.all([
					import("../../lib/db"),
					import("../../lib/terminal-host"),
					import("../../lib/config"),
				]);
				const host = await getTerminalHost();
				const panes = addViewedStateToPanes(getDb().index, await host.listPanes());
				return Response.json(
					HerdrPaneIndexResponse.parse({panes, writesEnabled: terminalWritesEnabled() && host.canWrite}),
					{
						headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
					},
				);
			},
		}),
	},
});
