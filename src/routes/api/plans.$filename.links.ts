import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {PlanLinksResponse} from "../../lib/api/plans";
import {homedir} from "node:os";
import {fromMdSlug} from "../../lib/md-slug";

/** The project path as the session rail shows a folder: `~`-relative under home. */
function homeRelative(path: string, home: string): string {
	return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export const Route = createFileRoute("/api/plans/$filename/links")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {filename: string}}) => {
				const {getDb} = await import("../../lib/db");
				const {getPlanLinksFromDb} = await import("../../lib/db/queries");

				const {index} = getDb();
				const links = getPlanLinksFromDb(index, fromMdSlug(params.filename));
				const serialized = links.map((l) => ({
					sessionId: l.sessionId,
					project: l.projectId,
					projectName: l.projectName,
					projectDir: l.projectPath === null ? null : homeRelative(l.projectPath, homedir()),
					sessionTitle: l.sessionTitle,
					sessionModified: l.sessionMtimeMs === null ? null : new Date(l.sessionMtimeMs).toISOString(),
				}));

				return Response.json(PlanLinksResponse.parse(serialized), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
