import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {type ComposerStateDependencies, getComposerState} from "../../lib/composer-state";

export async function handleComposerStateRequest(
	sessionId: string,
	dependencies: ComposerStateDependencies,
): Promise<Response> {
	return Response.json(await getComposerState(sessionId, dependencies), {
		headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
	});
}

export const Route = createFileRoute("/api/sessions/$id/composer-state")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const {join} = await import("node:path");
				const {homedir} = await import("node:os");
				const {readFile, stat} = await import("node:fs/promises");
				const {getCacheDir} = await import("../../lib/db/connection");
				return handleComposerStateRequest(params.id, {
					readStatusline: async (sessionId) => {
						const filePath = join(getCacheDir(), "statusline", `${sessionId}.json`);
						const [raw, stats] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);
						return {json: JSON.parse(raw) as unknown, mtimeMs: stats.mtimeMs};
					},
					readSettings: async () =>
						JSON.parse(await readFile(join(homedir(), ".claude", "settings.json"), "utf-8")) as unknown,
				});
			},
		}),
	},
});
