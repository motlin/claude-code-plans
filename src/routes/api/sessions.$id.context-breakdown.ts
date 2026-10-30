import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";
import {SESSION_ID_PATTERN} from "../../lib/api/statusline";
import type {ContextBreakdown} from "../../lib/context-breakdown";

interface SessionContextBreakdownDependencies {
	readBreakdown(sessionId: string): Promise<ContextBreakdown | null>;
}

const NO_STORE = {"Cache-Control": "private, max-age=0, must-revalidate"};

/** The ccb-context-mirror mod's latest breakdown for a session, or null. */
export async function handleSessionContextBreakdownRequest(
	sessionId: string,
	dependencies: SessionContextBreakdownDependencies,
): Promise<Response> {
	const breakdown = SESSION_ID_PATTERN.test(sessionId) ? await dependencies.readBreakdown(sessionId) : null;
	return Response.json(breakdown, {headers: NO_STORE});
}

export const Route = createFileRoute("/api/sessions/$id/context-breakdown")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async ({params}: {params: {id: string}}) => {
				const {readContextMirror} = await import("../../lib/context-breakdown-reader");
				return handleSessionContextBreakdownRequest(params.id, {
					readBreakdown: async (sessionId) => readContextMirror(sessionId),
				});
			},
		}),
	},
});
