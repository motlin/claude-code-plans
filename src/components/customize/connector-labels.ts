import type {McpScope} from "../../lib/api/customize";

/** claude.ai connectors are managed in the cloud; their rows link here. */
export const CLAUDE_AI_CONNECTORS_URL = "https://claude.ai/customize/connectors/yours";

/** The host of an http/sse server URL, used for its favicon. */
export function connectorDomain(transport: string, urlOrCommand: string): string | null {
	if (transport === "stdio") return null;
	try {
		return new URL(urlOrCommand).hostname || null;
	} catch {
		return null;
	}
}

export const SCOPE_LABEL = {
	user: "User",
	local: "Local",
	project: "Project",
	plugin: "Plugin",
} as const satisfies Record<McpScope, string>;

/** Upstream Type column: "Local" for stdio servers, "Web" for http/sse. */
export function transportLabel(transport: string): "Local" | "Web" {
	return transport === "stdio" ? "Local" : "Web";
}
