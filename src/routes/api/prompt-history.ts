import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {PromptHistoryResponse} from "../../lib/api/prompt-history";
import {nonEmpty} from "../../lib/non-empty";

export const Route = createFileRoute("/api/prompt-history")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({request}: {request: Request}) => {
				const sessionId = nonEmpty(new URL(request.url).searchParams.get("sessionId")?.trim());
				const {readPromptHistory} = await import("../../lib/prompt-history.server");
				return Response.json(PromptHistoryResponse.parse(await readPromptHistory({sessionId})), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
