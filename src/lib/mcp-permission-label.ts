/** An MCP tool permission's label ("create issue (github)") and the server words it came from. */
export interface McpPermissionLabel
{
	label: string;
	origin?: string;
}

/** Upstream's `Rc`: split `mcp__{server}__{tool}` at the last `__`; undefined when either part is empty. */
function parseMcpName(name: string):
	|
	  {
			serverName: string;
			toolName: string;
	  }
	| undefined
{
	const rest = name.slice("mcp__".length).replace(/_+$/, "");
	const split = rest.lastIndexOf("__");
	if (split <= 0) return undefined;
	const toolName = rest.slice(split + 2);
	const serverName = rest.slice(0, split).replace(/^_+|_+$/g, "");
	if (toolName === "" || serverName === "") return undefined;
	return {
		serverName,
		toolName,
	};
}

/** Upstream's `ya`: every run of underscores becomes one space. */
function spaceUnderscores(text: string): string
{
	return text.replace(/_+/g, " ");
}

/** Upstream's `$p`: invisible code points, keeping tabs, line breaks, ZWNJ and ZWJ. */
const INVISIBLE = new RegExp(
	String.raw`(?![\t\n\r\u200C\u200D])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u034F\u115F\u1160\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]`,
	"gu",
);

/** Upstream's `br` display sanitizer: the first 4000 chars on one line, invisibles dropped. */
function displayText(text: string): string
{
	return text
		.slice(0, 4000)
		.replace(INVISIBLE, "")
		.replace(/[\n\r\u2028\u2029]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Upstream's `mcp__` permission copy, parse fallback: "{tool words} ({server words})" with the server
 * words as the origin, or the name's words alone when it doesn't parse. Null for a non-MCP tool.
 */
export function mcpPermissionLabel(name: string): McpPermissionLabel | null
{
	if (!name.startsWith("mcp__")) return null;
	const parsed = parseMcpName(name);
	if (parsed === undefined)
	{
		return {
			label: spaceUnderscores(name.slice("mcp__".length).replace(/^_+|_+$/g, "")) || name,
		};
	}
	const origin = displayText(spaceUnderscores(parsed.serverName)) || "unknown server";
	return {
		label: `${spaceUnderscores(parsed.toolName)} (${origin})`,
		origin,
	};
}
