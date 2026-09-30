import {createFileRoute} from "@tanstack/react-router";
import {ArtifactListResponse} from "../../lib/api/artifacts";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/artifacts")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const {getDb} = await import("../../lib/db");
				const {getArtifacts} = await import("../../lib/db/artifact-queries");

				const q = new URL(request.url).searchParams.get("q") ?? "";
				const artifacts = getArtifacts(getDb().index, {q});

				return Response.json(ArtifactListResponse.parse(artifacts), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
