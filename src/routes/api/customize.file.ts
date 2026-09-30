import {createFileRoute} from "@tanstack/react-router";
import {CustomizeFileResponse} from "../../lib/api/customize";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

const PRIVATE_NO_CACHE = "private, max-age=0, must-revalidate";

function errorResponse(error: string, status: number): Response {
	return Response.json({error}, {status, headers: {"Cache-Control": PRIVATE_NO_CACHE}});
}

/** The directory a `?skill=<id>` or `?plugin=<id>` query addresses, or an error response. */
async function resolveRoot(url: URL): Promise<string | Response> {
	const skillId = url.searchParams.get("skill");
	const pluginId = url.searchParams.get("plugin");
	if (skillId !== null) {
		const {findIndexedSkill} = await import("../../lib/customize/indexed-skills");
		const skill = await findIndexedSkill(skillId);
		return skill === undefined ? errorResponse("Skill not found", 404) : skill.dir;
	}
	if (pluginId !== null) {
		const {listPlugins} = await import("../../lib/plugins");
		const plugin = (await listPlugins()).find((candidate) => candidate.id === pluginId);
		return plugin === undefined ? errorResponse("Plugin not found", 404) : plugin.installPath;
	}
	return errorResponse("a skill or plugin query parameter is required", 400);
}

/**
 * One file inside a listed skill's directory (`?skill=<id>&path=<relative>`)
 * or an installed plugin's directory (`?plugin=<id>&path=<relative>`). The
 * path is resolved by `readFileUnderRoot`, which refuses `..`, absolute paths
 * and symlinks that land outside the root directory.
 */
export const Route = createFileRoute("/api/customize/file")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const url = new URL(request.url);
				const path = url.searchParams.get("path");
				if (path === null) return errorResponse("path query parameter is required", 400);

				const root = await resolveRoot(url);
				if (root instanceof Response) return root;

				const {FileServingError, readFileUnderRoot} = await import("../../lib/file-serving");
				try {
					const file = await readFileUnderRoot(root, path);
					return Response.json(CustomizeFileResponse.parse({path, content: file.content}), {
						headers: {"Cache-Control": PRIVATE_NO_CACHE},
					});
				} catch (error) {
					if (error instanceof FileServingError) return errorResponse(error.message, error.status);
					throw error;
				}
			},
		}),
	},
});
