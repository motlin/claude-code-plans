import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/claude-code-settings")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {handleClaudeCodeSettingsGet} = await import("../../lib/claude-code-settings");
				return handleClaudeCodeSettingsGet();
			},
			POST: async ({request}: {request: Request}) => {
				const {handleClaudeCodeSettingsPost} = await import("../../lib/claude-code-settings");
				return handleClaudeCodeSettingsPost(request);
			},
		}),
	},
});
