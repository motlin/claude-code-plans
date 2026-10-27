import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/output-styles")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {handleOutputStylesGet} = await import("../../lib/output-styles");
				return handleOutputStylesGet();
			},
		}),
	},
});
