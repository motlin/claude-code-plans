/**
 * `Elicitation` / `ElicitationResult` payloads in the hooks reference's shape
 * (code.claude.com/docs/en/hooks, 2.1.302). Not captured live: they need an
 * MCP server that sends an elicitation request.
 */
const base = {
	session_id: "abc-123",
	transcript_path: "/Users/u/.claude/projects/-Users-u-projects-app/abc-123.jsonl",
	cwd: "/Users/u/projects/app",
};

export const elicitationFormFixture = {
	...base,
	hook_event_name: "Elicitation" as const,
	mcp_server_name: "my-mcp-server",
	message: "Please provide your credentials",
	mode: "form" as const,
	requested_schema: {
		type: "object",
		properties: {
			username: {type: "string", title: "Username"},
		},
	},
};

export const elicitationUrlFixture = {
	...base,
	hook_event_name: "Elicitation" as const,
	mcp_server_name: "my-mcp-server",
	message: "Please authenticate",
	mode: "url" as const,
	url: "https://auth.example.com/login",
};

export const elicitationResultFixture = {
	...base,
	hook_event_name: "ElicitationResult" as const,
	mcp_server_name: "my-mcp-server",
	action: "accept" as const,
	content: {username: "alice"},
	mode: "form" as const,
};
