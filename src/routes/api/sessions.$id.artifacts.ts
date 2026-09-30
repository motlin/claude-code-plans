import {createFileRoute} from "@tanstack/react-router";
import {SessionArtifactListResponse} from "../../lib/api/artifacts";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

/** The artifacts this session published or opened, for its Artifacts pane. */
export const Route = createFileRoute("/api/sessions/$id/artifacts")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const {getDb} = await import("../../lib/db");
				const {getSessionArtifacts} = await import("../../lib/db/artifact-queries");

				const artifacts = getSessionArtifacts(getDb().index, params.id);

				return Response.json(SessionArtifactListResponse.parse(artifacts), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
