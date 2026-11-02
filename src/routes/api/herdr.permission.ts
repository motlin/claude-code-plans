import {createFileRoute} from "@tanstack/react-router";
import {expediteAfterAnswer} from "../../lib/api/expedite-after-answer";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {expediteSessionJsonlRead} from "../../lib/watcher";

export const Route = createFileRoute("/api/herdr/permission")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const {getTerminalHost} = await import("../../lib/terminal-host");
				const host = await getTerminalHost();
				return expediteAfterAnswer(
					request,
					async (answer) => host.answerPermission(answer),
					expediteSessionJsonlRead,
				);
			},
		}),
	},
});
