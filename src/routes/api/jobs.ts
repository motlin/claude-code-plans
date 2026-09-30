import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {JobListResponse} from "../../lib/api/jobs";

export const Route = createFileRoute("/api/jobs")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {homedir} = await import("node:os");
				const {join} = await import("node:path");
				const {readJobs} = await import("../../lib/jobs-reader");

				const jobs = await readJobs(join(homedir(), ".claude", "jobs"));

				return Response.json(JobListResponse.parse(jobs), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
