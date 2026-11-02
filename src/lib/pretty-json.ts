// Upstream claude.ai/code's JSON pretty-printer for generic tool bodies (cb6930dae `qg` + `Kg`), dumped in
// .llm/upstream-sync/dumps/tool-output-body-kinds-bundle-2026-11-06.js.txt. Kept apart from the kind classifier
// so the transcript reader can use it without pulling in the secret masker.

/** Fg: the longest text any body kind check looks at. */
export const MAX_CHARS = 1e5;
/** Lg: the running indentation budget past which pretty-printing gives up. */
const INDENT_BUDGET = 4 * MAX_CHARS;
/** Rg: the longest pretty JSON drawn as a code tile. */
export const JSON_TILE_MAX_LINES = 2e3;

/** Kg: re-indent JSON text two spaces a level, copying strings (escapes and all) verbatim. */
function reindent(json: string): string | undefined
{
	const out: string[] = [];
	let depth = 0;
	let budget = 0;
	let inString = false;
	const newline = () =>
	{
		budget += 2 * depth;
		out.push("\n", "  ".repeat(depth));
	};
	for (let i = 0; i < json.length; i++)
	{
		if (budget > INDENT_BUDGET) return undefined;
		const c = json.charAt(i);
		if (inString)
		{
			out.push(c);
			if (c === "\\")
			{
				i += 1;
				out.push(json.charAt(i));
			}
			else if (c === '"') inString = false;
		}
		else if (c === '"')
		{
			inString = true;
			out.push(c);
		}
		else if (c === "{" || c === "[")
		{
			let next = i + 1;
			while (next < json.length && json.charAt(next).trim() === "") next += 1;
			const close = json.charAt(next);
			if (close === "}" || close === "]")
			{
				out.push(c, close);
				i = next;
			}
			else
			{
				out.push(c);
				depth += 1;
				newline();
			}
		}
		else if (c === "}" || c === "]")
		{
			depth -= 1;
			newline();
			out.push(c);
		}
		else if (c === ",")
		{
			out.push(c);
			newline();
		}
		else if (c === ":") out.push(": ");
		else if (c.trim() !== "") out.push(c);
	}
	return out.join("");
}

/** qg: the text pretty-printed when it is a JSON object or array of at most 1e5 characters. */
export function prettyJson(text: string): string | undefined
{
	const trimmed = text.trim();
	if (trimmed.length > MAX_CHARS || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return undefined;
	try
	{
		JSON.parse(trimmed);
	}
	catch
	{
		return undefined;
	}
	return reindent(trimmed);
}
