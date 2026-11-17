import type {WorkflowInput} from "./tool-input-schemas";

/** Upstream c62b4c3e1 `f`: the `meta.name` literal near the top of an inline workflow script. */
const META_NAME_PATTERN = /\bmeta\s*=\s*\{[^}]*?\bname\s*:\s*['"]([^'"]+)['"]/;
const META_SCAN_CHARS = 4096;

/** Upstream `m5`: last path segment, tolerating one trailing separator and Windows paths. */
function pathBasename(path: string): string
{
	const trimmed = path.replace(/[\\/]$/, "");
	const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return lastSeparator === -1 ? trimmed : trimmed.slice(lastSeparator + 1);
}

/** Upstream `Kc`: drop the final extension unless that leaves nothing. */
function stripExtension(fileName: string): string
{
	return fileName.replace(/\.\w+$/, "") || fileName;
}

/**
 * Display name for a Workflow tool call, matching upstream c62b4c3e1 `m`:
 * `input.name`, then the script's `meta.name` (first 4096 chars), then the
 * extensionless basename of `input.scriptPath`.
 */
export function workflowName(input: WorkflowInput): string | undefined
{
	if (input.name) return input.name;
	if (input.script !== undefined)
	{
		const match = META_NAME_PATTERN.exec(input.script.slice(0, META_SCAN_CHARS));
		if (match?.[1] !== undefined) return match[1];
	}
	if (input.scriptPath) return stripExtension(pathBasename(input.scriptPath));
	return undefined;
}

/** `workflowName` for a tool call's raw input, reading only its string fields. */
export function workflowCallName(input: Readonly<Record<string, unknown>>): string | undefined
{
	const field = (key: string) => (typeof input[key] === "string" ? input[key] : undefined);
	const name = field("name");
	const script = field("script");
	const scriptPath = field("scriptPath");
	return workflowName(
		{
			...(name === undefined
				? null
				:
					{
						name,
					}),
			...(script === undefined
				? null
				:
					{
						script,
					}),
			...(scriptPath === undefined
				? null
				:
					{
						scriptPath,
					}),
		},
	);
}

/** A workflow's `export const meta` fields, as upstream's `ao` reads them. */
export interface WorkflowMeta
{
	name?: string;
	description?: string;
	phases?: WorkflowMetaPhase[];
}

export interface WorkflowMetaPhase
{
	title: string;
	detail?: string;
}

/** Upstream cd00a96b4 `t`: the last index of a comment or quoted string starting at `index`, or -1. */
function skipCommentOrString(text: string, index: number): number
{
	const char = text[index];
	if (char === "/" && text[index + 1] === "/")
	{
		let end = index + 2;
		while (end < text.length && text[end] !== "\n") end++;
		return end;
	}
	if (char === "/" && text[index + 1] === "*")
	{
		for (let end = index + 2; end + 1 < text.length; end++)
		{
			if (text[end] === "*" && text[end + 1] === "/") return end + 1;
		}
		return text.length;
	}
	if (char === '"' || char === "'" || char === "`")
	{
		let end = index + 1;
		for (; end < text.length && text[end] !== char; end++)
		{
			if (text[end] === "\\") end++;
		}
		return end;
	}
	return -1;
}

/** Upstream `n`: the text between the bracket at `start` and its balanced closer. */
function balancedBody(text: string, start: number, open: string, close: string): string | undefined
{
	if (text[start] !== open) return undefined;
	let depth = 0;
	for (let index = start; index < text.length; index++)
	{
		const skipped = skipCommentOrString(text, index);
		if (skipped !== -1)
		{
			index = skipped;
			continue;
		}
		if (text[index] === open) depth++;
		else if (text[index] === close && --depth === 0) return text.slice(start + 1, index);
	}
	return undefined;
}

/** Upstream `r`: where `key:` sits at the body's top level, or -1. */
function topLevelKey(body: string, key: string): number
{
	let depth = 0;
	for (let index = 0; index < body.length; index++)
	{
		const skipped = skipCommentOrString(body, index);
		if (skipped !== -1)
		{
			index = skipped;
			continue;
		}
		const char = body[index];
		if (char === "{" || char === "[")
		{
			depth++;
			continue;
		}
		if (char === "}" || char === "]")
		{
			depth--;
			continue;
		}
		if (
			depth === 0 &&
			body.startsWith(key, index) &&
			!/\w/.test(body[index - 1] ?? "") &&
			/^\s*:/.test(body.slice(index + key.length))
		)
		{
			return index;
		}
	}
	return -1;
}

const LITERAL_PATTERN = /^\s*:\s*(['"`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/;

/**
 * Upstream `i`: a top-level key's quoted literal, with `\n`/`\t`/`\r` read as a space, `\u`/`\x` kept
 * escaped and any other escape unwrapped.
 */
function literalValue(body: string, key: string): string | undefined
{
	const index = topLevelKey(body, key);
	if (index === -1) return undefined;
	return LITERAL_PATTERN.exec(body.slice(index + key.length))?.[2]?.replace(/\\([\s\S])/g, (_escape, char: string) =>
		char === "n" || char === "t" || char === "r" ? " " : char === "u" || char === "x" ? `\\${char}` : char,
	);
}

/** Upstream `a`: the `phases` array's `{title, detail?}` entries. */
function metaPhases(body: string): WorkflowMetaPhase[] | undefined
{
	const index = topLevelKey(body, "phases");
	if (index === -1) return undefined;
	const after = "phases".length + index;
	const opener = /^\s*:\s*\[/.exec(body.slice(after));
	if (!opener) return undefined;
	const list = balancedBody(body, after + opener[0].length - 1, "[", "]");
	if (list === undefined) return undefined;
	const phases: WorkflowMetaPhase[] = [];
	for (let entry = 0; entry < list.length; entry++)
	{
		if (list[entry] !== "{") continue;
		const object = balancedBody(list, entry, "{", "}");
		if (object === undefined) break;
		const title = literalValue(object, "title");
		if (title)
		{
			const detail = literalValue(object, "detail");
			phases.push(
				detail
					?
						{
							title,
							detail,
						}
					:
						{
							title,
						},
			);
		}
		entry += object.length + 1;
	}
	return phases.length > 0 ? phases : undefined;
}

/** Upstream `s`: the index of the `{` of a line-leading `export const meta = {` outside comments and strings, or -1. */
function metaStart(script: string): number
{
	let lineStart = true;
	for (let index = 0; index < script.length; index++)
	{
		const skipped = skipCommentOrString(script, index);
		if (skipped !== -1)
		{
			lineStart = script[skipped] === "\n";
			index = skipped;
			continue;
		}
		if (lineStart)
		{
			const match = /^\s*export\s+const\s+meta\s*=\s*\{/.exec(script.slice(index));
			if (match) return index + match[0].length - 1;
		}
		lineStart = script[index] === "\n";
	}
	return -1;
}

/**
 * Upstream cd00a96b4 `o` (`ao`): the workflow's name (a non-empty `input.name`, else the script's
 * `export const meta` name, else `workflowCallName`) and the meta's description and phases.
 */
export function parseWorkflowMeta(input: Readonly<Record<string, unknown>>): WorkflowMeta
{
	const script = typeof input["script"] === "string" ? input["script"] : undefined;
	const named = typeof input["name"] === "string" && input["name"] ? input["name"] : undefined;
	const fallback = workflowCallName(input);
	const body = script ? balancedBody(script, metaStart(script), "{", "}") : undefined;
	const name = named ?? (body === undefined ? undefined : literalValue(body, "name")) ?? fallback;
	const description = body === undefined ? undefined : literalValue(body, "description");
	const phases = body === undefined ? undefined : metaPhases(body);
	return {
		...(name === undefined
			? null
			:
				{
					name,
				}),
		...(description === undefined
			? null
			:
				{
					description,
				}),
		...(phases === undefined
			? null
			:
				{
					phases,
				}),
	};
}

/** Whether any assistant line calls the Workflow tool, so the page only fetches workflow runs when it can draw one. */
export function linesHaveWorkflowCall(
	lines: ReadonlyArray<
	{
		type: string;
		message?:
			|
			  {
					content?: unknown;
			  }
			| undefined;
	}>,
): boolean
{
	return lines.some((line) =>
	{
		if (line.type !== "assistant") return false;
		const content = line.message?.content;
		return (
			Array.isArray(content) &&
			content.some(
				(block: unknown) =>
					typeof block === "object" &&
					block !== null &&
					"type" in block &&
					block.type === "tool_use" &&
					"name" in block &&
					block.name === "Workflow",
			)
		);
	});
}

/** Upstream `Se`. */
const SUMMARY_PREFIX = /^(?:Dynamic w|W)orkflow ".*" (?:completed|failed|stopped|was killed)(?::\s*(.+))?\.?\s*$/s;

function capitalize(text: string): string
{
	return text.length > 0 ? (text[0] ?? "").toUpperCase() + text.slice(1) : text;
}

/**
 * Upstream `we`: a task summary without the `Workflow "…" completed|failed|…:`
 * boilerplate, capitalized; undefined when it says nothing beyond the description.
 */
export function workflowSummary(summary: string | undefined, description: string | undefined): string | undefined
{
	if (!summary || summary === description) return undefined;
	const match = SUMMARY_PREFIX.exec(summary);
	if (match)
	{
		const detail = match[1]?.trim();
		return detail ? capitalize(detail) : undefined;
	}
	return capitalize(summary);
}
