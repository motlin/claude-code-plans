import {createFileRoute} from "@tanstack/react-router";
import {ClaudeAiConnectorListResponse} from "../../lib/api/customize";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/customize/claude-ai-connectors")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {getDb} = await import("../../lib/db");
				const {listMcpToolNames} = await import("../../lib/db/queries");
				const {listClaudeAiConnectors} = await import("../../lib/customize/mcp");
				const connectors = await listClaudeAiConnectors({
					toolNames: listMcpToolNames(getDb().index),
				});
				return Response.json(ClaudeAiConnectorListResponse.parse(connectors), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
