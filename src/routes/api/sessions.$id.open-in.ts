import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionOpenInResponse} from "../../lib/api/sessions";

/** What the row menu's Open in ▸ and the rail's Environment menus need: the session directory, its claude.ai bridge session, its live Remote Control bridge, whether its history reached claude.ai, and its GitHub repo. */
export const Route = createFileRoute("/api/sessions/$id/open-in")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const [
					{homedir},
					{join},
					{getDb},
					{getSessionDirectory},
					{readBridgeSession, resolveSessionFilePath},
					{readOriginGitHubUrl},
					{getRegistrySessionState},
					{registryRemoteControl},
					{historySuppressionCauseLabel},
				] = await Promise.all([
					import("node:os"),
					import("node:path"),
					import("../../lib/db"),
					import("../../lib/db/queries"),
					import("../../lib/sessions"),
					import("../../lib/session-own-pr"),
					import("../../lib/session-registry-store"),
					import("../../lib/session-environment"),
					import("../../lib/schema-choices"),
				]);
				const {index} = getDb();
				const cwd = getSessionDirectory(index, params.id);
				const resolved = await resolveSessionFilePath(join(homedir(), ".claude", "projects"), params.id);
				const bridge = resolved
					? await readBridgeSession(resolved.filePath)
					: {bridgeSessionId: null, remoteHistory: null};
				const {bridgeSessionId} = bridge;
				const cause = bridge.remoteHistory?.cause ?? null;
				const remoteHistory =
					bridge.remoteHistory === null
						? null
						: {reason: cause === null ? null : (historySuppressionCauseLabel(cause) ?? null)};
				const githubUrl = cwd === null ? null : readOriginGitHubUrl(cwd);
				const remoteControl = registryRemoteControl(getRegistrySessionState(params.id));
				return Response.json(
					SessionOpenInResponse.parse({cwd, bridgeSessionId, remoteControl, remoteHistory, githubUrl}),
					{
						headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
					},
				);
			},
		}),
	},
});
