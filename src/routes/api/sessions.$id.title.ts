import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {RenameSessionBody} from "../../lib/api/sessions";
import {rejectCrossSite} from "../../lib/same-origin-guard";

export const Route = createFileRoute("/api/sessions/$id/title")({
	server: {
		handlers: withMethodNotAllowed({
			PUT: async ({params, request}: {params: {id: string}; request: Request}) => {
				const rejection = rejectCrossSite(request);
				if (rejection) return rejection;

				let json: unknown;
				try {
					json = await request.json();
				} catch {
					return Response.json({error: "Invalid JSON"}, {status: 400});
				}
				const body = RenameSessionBody.safeParse(json);
				if (!body.success) {
					return Response.json({error: body.error.message}, {status: 400});
				}

				const [{homedir}, {join}, {getDb}, {renameSessionTitle}, {broadcastTyped}, {getTerminalHost}] =
					await Promise.all([
						import("node:os"),
						import("node:path"),
						import("../../lib/db"),
						import("../../lib/session-rename"),
						import("../../lib/sse-broadcast"),
						import("../../lib/terminal-host"),
					]);
				return renameSessionTitle({
					db: getDb().index,
					claudeDir: join(homedir(), ".claude"),
					sessionId: params.id,
					title: body.data.title,
					broadcast: broadcastTyped,
					// The prompt endpoint's own checks (same origin, Live terminal input, a ready agent) still apply.
					promptLiveSession: async (sessionId, prompt) => {
						const headers = new Headers(request.headers);
						headers.delete("Content-Length");
						const body = JSON.stringify({sessionId, prompt});
						return (await getTerminalHost()).prompt(
							new Request(request.url, {method: "POST", headers, body}),
						);
					},
				});
			},
		}),
	},
});
