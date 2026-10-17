import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {TaskOutputResponse} from "../../lib/api/task-output";

const NO_STORE = {"Cache-Control": "private, no-store"};

/**
 * `?file=<path>` serves the tail of a background task's CLI output file, only
 * for the CLI's `claude-<uid>/<project>/<session>/tasks/<id>.output` files of
 * this session's project under the system temp dir.
 */
export const Route = createFileRoute("/api/sessions/$id/task-output")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params, request}: {params: {id: string}; request: Request}) => {
				const file = new URL(request.url).searchParams.get("file");
				const {getDb} = await import("../../lib/db");
				const {getSessionProjectId} = await import("../../lib/db/queries");
				const projectId = getSessionProjectId(getDb().index, params.id);
				if (file === null || projectId === null) {
					return Response.json({status: "refused"}, {status: 403, headers: NO_STORE});
				}
				const {defaultTaskOutputRoots, readTaskOutput} = await import("../../lib/task-output");
				const result = await readTaskOutput(file, {
					roots: await defaultTaskOutputRoots(),
					uid: process.getuid?.() ?? -1,
					projectId,
				});
				if (result.status === "refused") return Response.json(result, {status: 403, headers: NO_STORE});
				return Response.json(TaskOutputResponse.parse(result), {headers: NO_STORE});
			},
		}),
	},
});
