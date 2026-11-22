import {stripAnsi} from "./ansi-codes";
import {chapterFromInput, isChapterTool} from "./chapter-tool";
import {isRecord} from "./narrow";
import {maskSecrets} from "./secret-mask";
import {cleanPromptText, parseBashInput, parseBashOutput} from "./session-utils";
import type {ToolResultInfo} from "./sessions";
import {type ChecklistItem, taskChecklist} from "./task-checklist";
import type {SessionContentBlock, SessionLine} from "./transcript";

/**
 * Upstream's terminal transcript view (`epitaxy_terminal_view`, chunk cf6989767) flattens the
 * transcript into CLI-look lines: prompts, assistant text, thinking, ⏺ tool rows with a ⎿ result,
 * ☐/☒ todos, ◈ events, ── chapters and errors. This is its line model (`J`/`ne`/`B`/`z`) over the
 * local parsed JSONL lines.
 */
export type TerminalLine =
	|
	  {
			kind: "prompt" | "assistant" | "thinking" | "error";
			id: string;
			text: string;
	  }
	| TerminalToolLine
	|
	  {
			kind: "todos";
			id: string;
			items: ChecklistItem[];
	  }
	|
	  {
			kind: "event";
			id: string;
			label: TerminalEventLabel;
	  }
	|
	  {
			kind: "chapter";
			id: string;
			title: string;
	  }
	|
	  {
			kind: "prompt_blocked";
			id: string;
			reason: string;
	  };

export type TerminalEventLabel =
	|
	  {
			kind: "text";
			text: string;
	  }
	|
	  {
			kind: "item";
			itemKind: string;
	  };

export type TerminalToolStatus = "running" | "completed" | "error";

export interface TerminalToolLine extends TerminalToolResult
{
	kind: "tool";
	id: string;
	name: string;
	arg: string | undefined;
	status: TerminalToolStatus;
	interrupted: boolean;
	rejected: boolean;
	isError: boolean;
}

export interface TerminalToolResult
{
	/** The output's first non-blank line, trimmed and capped at 200 chars. */
	resultSummary: string | undefined;
	/** Lines after the summary line. */
	resultExtraLineCount: number;
	/** The output from its first non-blank line (capped at 20 000 chars), kept only when there is more to show. */
	resultFullText: string | undefined;
}

/** Upstream `D`, `O`, `k`. */
const NAME_ARG_MAX = 96;
const SUMMARY_MAX = 200;
const FULL_TEXT_MAX = 20_000;

/** Upstream `A`: the tools drawn as a todo list when their input names items. */
const TODO_TOOLS: ReadonlySet<string> = new Set(["TodoWrite", "TaskCreate", "TaskUpdate"]);

/** Upstream `j`: the input keys a tool row's argument is read from, in priority order. */
const ARG_KEYS = [
	"command",
	"file_path",
	"notebook_path",
	"pattern",
	"path",
	"url",
	"query",
	"description",
	"prompt",
	"skill",
	"title",
	"name",
	"message",
] as const;

/** Upstream `M`. */
function collapseWhitespace(text: string): string
{
	return text.replace(/\s+/g, " ").trim();
}

/** Upstream `N`. */
function truncateTerminal(text: string, max: number): string
{
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Upstream `P`. */
function clip(text: string): string
{
	return truncateTerminal(collapseWhitespace(maskSecrets(text)), NAME_ARG_MAX);
}

/** Upstream `F`: the first non-empty string among the priority keys, else the first string value. */
function terminalToolArg(input: Record<string, unknown>): string | undefined
{
	for (const key of ARG_KEYS)
	{
		const value = input[key];
		if (typeof value === "string" && value.trim() !== "") return clip(value);
	}
	for (const value of Object.values(input)) if (typeof value === "string" && value.trim() !== "") return clip(value);
	return undefined;
}

/** Upstream `I`: `mcp__srv__tool` reads `srv:tool (MCP)`. */
function terminalToolName(name: string): string
{
	return clip(name.startsWith("mcp__") ? `${name.slice(5).split("__").join(":")} (MCP)` : name);
}

/** Upstream `z`: a tool output's ⎿ summary line, extra line count and expandable full text. */
export function terminalToolResult(output: string | undefined): TerminalToolResult
{
	const empty: TerminalToolResult =
	{
		resultSummary: undefined,
		resultExtraLineCount: 0,
		resultFullText: undefined,
	};
	if (output === undefined || output === "") return empty;
	const text = maskSecrets(stripAnsi(output)).trimEnd();
	const lines = text.split("\n");
	let start = 0;
	for (const line of lines)
	{
		if (line.trim() !== "")
		{
			const summary = line.trim();
			const full = truncateTerminal(text.slice(start), FULL_TEXT_MAX);
			const extra = full.split("\n").length - 1;
			return {
				resultSummary: truncateTerminal(summary, SUMMARY_MAX),
				resultExtraLineCount: extra,
				resultFullText: extra > 0 || summary.length > SUMMARY_MAX ? full : undefined,
			};
		}
		start += line.length + 1;
	}
	return empty;
}

/** Upstream `R`: an event line naming the transcript item kind it stands in for. */
function itemEvent(id: string, itemKind: string): TerminalLine
{
	return {
		kind: "event",
		id,
		label:
		{
			kind: "item",
			itemKind,
		},
	};
}

function toolStatus(result: ToolResultInfo | undefined): TerminalToolStatus
{
	if (result === undefined) return "running";
	return result.isError ? "error" : "completed";
}

/** Upstream `B`: a tool call's row, or its todo list. */
function toolLine(
	block:
	{
		id: string;
		name: string;
		input: Record<string, unknown>;
	},
	result: ToolResultInfo | undefined,
): TerminalLine
{
	if (TODO_TOOLS.has(block.name))
	{
		const items = taskChecklist(block.name, block.input).map((item) => (
		{
			...item,
			content: maskSecrets(item.content),
		}));
		if (items.length > 0)
			return {
				kind: "todos",
				id: block.id,
				items,
			};
	}
	const interrupted = result?.interrupted === true;
	const status = toolStatus(result);
	return {
		kind: "tool",
		id: block.id,
		name: terminalToolName(block.name),
		arg: terminalToolArg(block.input),
		status,
		interrupted,
		// Upstream's `rejected || policyDenied`: a refused call, not one cut short.
		rejected: result?.denied === true || result?.blocked === true || (result?.stopped === true && !interrupted),
		isError: status === "error" && !interrupted,
		...terminalToolResult(result?.result),
	};
}

function blocksOf(content: string | SessionContentBlock[] | undefined): SessionContentBlock[]
{
	if (content === undefined) return [];
	return typeof content === "string"
		? [
				{
					type: "text",
					text: content,
				},
			]
		: content;
}

function textLine(kind: "prompt" | "assistant" | "thinking" | "error", id: string, text: string): TerminalLine
{
	return {
		kind,
		id,
		text: maskSecrets(text),
	};
}

/**
 * Upstream `J`: the terminal view's flat lines for a transcript. Tool rows take their status and
 * output from `toolResultMap`; a call with no result yet is running.
 */
export function buildTerminalLines(
	lines: readonly SessionLine[],
	toolResultMap: ReadonlyMap<string, ToolResultInfo>,
): TerminalLine[]
{
	const out: TerminalLine[] = [];
	// The ! shell row awaiting the output record that follows its input record.
	let openBash: TerminalToolLine | undefined;
	for (const line of lines)
	{
		const key = line.type === "user" || line.type === "assistant" ? (line.uuid ?? `#${line.lineIndex}`) : "";
		switch (line.type)
		{
			case "user":
			{
				if (line.isMeta === true || line.isCompactSummary === true) break;
				for (const [index, block] of blocksOf(line.message?.content).entries())
				{
					const id = `${key}:${index}`;
					if (block.type === "text")
					{
						const bashInput = parseBashInput(block.text);
						if (bashInput !== null)
						{
							openBash =
							{
								kind: "tool",
								id,
								name: "Bash",
								arg: clip(bashInput.command),
								status: "running",
								interrupted: false,
								rejected: false,
								isError: false,
								...terminalToolResult(undefined),
							};
							out.push(openBash);
							continue;
						}
						const bashOutput = parseBashOutput(block.text);
						if (bashOutput !== null)
						{
							if (openBash !== undefined)
							{
								const failed = bashOutput.stdout.trim() === "" && bashOutput.stderr.trim() !== "";
								Object.assign(
									openBash,
									{
										status: failed ? "error" : "completed",
										isError: failed,
									},
									terminalToolResult(failed ? bashOutput.stderr : bashOutput.stdout),
								);
								openBash = undefined;
							}
							continue;
						}
						const text = cleanPromptText(block.text);
						if (text !== "") out.push(textLine("prompt", id, text));
					}
					else if (block.type === "image") out.push(itemEvent(id, "image"));
					else if (block.type === "document") out.push(itemEvent(id, "file"));
				}
				break;
			}
			case "assistant":
			{
				const blocks = blocksOf(line.message?.content);
				if (line.isApiErrorMessage === true)
				{
					const text = blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
					if (text.trim() !== "") out.push(textLine("error", key, text));
					break;
				}
				for (const [index, block] of blocks.entries())
				{
					const id = `${key}:${index}`;
					if (block.type === "text")
					{
						if (block.text.trim() !== "") out.push(textLine("assistant", id, block.text));
					}
					else if (block.type === "thinking")
					{
						if (block.thinking.trim() !== "") out.push(textLine("thinking", id, block.thinking));
					}
					else if (block.type === "tool_use")
					{
						const input = isRecord(block.input) ? block.input : {};
						const result = toolResultMap.get(block.id);
						if (isChapterTool(block.name) && !(result?.isError === true && result.interrupted !== true))
						{
							const {title} = chapterFromInput(block.id, input);
							if (title !== "")
								out.push(
									{
										kind: "chapter",
										id: block.id,
										title: maskSecrets(title),
									},
								);
							continue;
						}
						out.push(
							toolLine(
								{
									id: block.id,
									name: block.name,
									input,
								},
								result,
							),
						);
					}
				}
				break;
			}
			case "attachment":
				if (line.humanPrompt !== undefined)
				{
					const content = line.humanPrompt.content;
					const text = cleanPromptText(
						typeof content === "string"
							? content
							: content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
					);
					if (text !== "") out.push(textLine("prompt", `#${line.lineIndex}`, text));
				}
				break;
			case "system":
				if (line.subtype === "compact_boundary") out.push(itemEvent(`#${line.lineIndex}`, "compacted"));
				else if (line.subtype === "model_refusal_no_fallback")
					out.push(
						textLine(
							"error",
							`#${line.lineIndex}`,
							line.apiRefusalExplanation ?? line.content ?? line.subtype,
						),
					);
				break;
			case "prompt-blocked":
				out.push(
					{
						kind: "prompt_blocked",
						id: `#${line.lineIndex}`,
						reason: maskSecrets(line.reason),
					},
				);
				break;
			case "hook-notice":
				out.push(itemEvent(`#${line.lineIndex}`, "hook_notice"));
				break;
			case "agent-name":
			case "agent-color":
			case "permission-mode":
			case "artifact-link":
			case "artifact-watch":
			case "continued-in":
			case "derived-from":
			case "background-launch":
			case "queued-prompt":
			case "queued-task-notification":
			case "worktree":
			case "unparsed":
				break;
		}
	}
	return out;
}
