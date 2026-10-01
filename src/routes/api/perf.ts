import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/perf")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const [{handlePerfBeacon}, {getCacheDir}] = await Promise.all([
					import("../../lib/perf/field-sink"),
					import("../../lib/db/connection"),
				]);
				return handlePerfBeacon(request, {cacheDir: getCacheDir()});
			},
		}),
	},
});
