import {createFileRoute} from "@tanstack/react-router";
import {McpServerListResponse} from "../../lib/api/customize";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/customize/mcp-servers")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {listMcpServers} = await import("../../lib/customize/mcp");
				const servers = await listMcpServers();
				return Response.json(McpServerListResponse.parse(servers), {
					headers: {"Cache-Control": "private, max-age=0, must-revalidate"},
				});
			},
		}),
	},
});
