import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/herdr/question")({
	server: {
		handlers: withMethodNotAllowed({
			POST: async ({request}: {request: Request}) => {
				const {handleHerdrQuestion} = await import("../../lib/herdr/question");
				return handleHerdrQuestion(request);
			},
		}),
	},
});
