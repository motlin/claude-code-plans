import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SessionOpenInResponse} from "../../lib/api/sessions";

/** What the row menu's Open in ▸ and the rail's Environment menus need: the session directory, its claude.ai bridge session and its GitHub repo. */
export const Route = createFileRoute("/api/sessions/$id/open-in")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const [
					{homedir},
					{join},
					{getDb},
					{getSessionDirectory},
					{readBridgeSessionId, resolveSessionFilePath},
					{readOriginGitHubUrl},
				] = await Promise.all([
					import("node:os"),
					import("node:path"),
					import("../../lib/db"),
					import("../../lib/db/queries"),
					import("../../lib/sessions"),
					import("../../lib/session-own-pr"),
				]);
				const {index} = getDb();
				const cwd = getSessionDirectory(index, params.id);
				const resolved = await resolveSessionFilePath(join(homedir(), ".claude", "projects"), params.id);
				const bridgeSessionId = resolved ? await readBridgeSessionId(resolved.filePath) : null;
				const githubUrl = cwd === null ? null : readOriginGitHubUrl(cwd);
				return Response.json(SessionOpenInResponse.parse({cwd, bridgeSessionId, githubUrl}), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
