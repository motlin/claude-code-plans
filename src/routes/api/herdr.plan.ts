import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/plan")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				return (await getTerminalHost()).readPlanDialog(request);
			},
			POST: async ({request}: {request: Request}) => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				return (await getTerminalHost()).answerPlan(request);
			},
		}),
	},
});
