import {isKeyOf, isRecord} from "./narrow";
import {isBenignToolError} from "./tool-labels";

/**
 * Minimal shape needed by summarizeToolCalls, categorize, and diffStatsForCall.
 * Satisfied by raw content blocks, readSession tool call objects, and test data alike.
 */
export interface ToolCallLike
{
	/** The tool_use id, which keys a call that names no file. */
	id?: string | undefined;
	name: string;
	input: Record<string, unknown>;
	isError?: boolean | undefined;
	/** The call's result text, which can mark an error benign. */
	result?: string | undefined;
	/** The user rejected or interrupted the call, so it settled without failing. */
	stopped?: boolean | undefined;
	/** The user rejected the call with a typed reply, so it settled without failing. */
	denied?: boolean | undefined;
	/** The auto-mode classifier refused the call or gave no verdict, so it settled "Blocked". */
	blocked?: boolean | undefined;
	/**
	 * Whether a Write created its file or updated one that existed, and the
	 * lines the result's patch says a file edit added and removed.
	 */
	resultMeta?:
		|
		  {
				writeType?: "create" | "update";
				patchStats?:
				{
					added: number;
					removed: number;
				};
		  }
		| undefined;
}

const COMMAND_MESSAGE_RE = /<command-message[^>]*>([\s\S]*?)<\/command-message>/;
const STRIP_BLOCK_RE =
	/<(?:command-name|command-args|local-command-stdout)[^>]*>[\s\S]*?<\/(?:command-name|command-args|local-command-stdout)>/g;
const STRIP_TAG_RE =
	/<\/?(?:command-message|command-name|command-args|command|local-command-caveat|local-command-stdout)[^>]*>/g;

/**
 * A paste the CLI wraps on lines of its own -- `<pasted_content id="5216">`, the
 * pasted text, then `</pasted_content id="5216">` -- which upstream shows as the
 * bare text. A tag quoted mid-line is something the user typed and stays.
 */
const PASTED_CONTENT_RE = /(^|\n)<pasted_content id="([^"\n]*)">\n(?:([\s\S]*?)\n)?<\/pasted_content id="\2">(?=\n|$)/g;

/** Keep the paste's text, and the line break before its opening tag, in place of the wrapper. */
const PASTED_CONTENT_TEXT = "$1$3";

/** The prompt with each pasted_content wrapper replaced by the text it wraps. */
export function unwrapPastedContent(text: string): string
{
	return text.replace(PASTED_CONTENT_RE, PASTED_CONTENT_TEXT);
}

function cleanCommandText(rawText: string): string
{
	const text = rawText.replace(PASTED_CONTENT_RE, PASTED_CONTENT_TEXT);
	const message = text.match(COMMAND_MESSAGE_RE)?.[1];
	if (message !== undefined)
	{
		return message.replace(STRIP_TAG_RE, "").trim();
	}
	return text.replace(STRIP_BLOCK_RE, "").replace(STRIP_TAG_RE, "").trim();
}

export function stripCommandTags(text: string): string
{
	return cleanCommandText(text);
}

/**
 * Harness tags upstream hides from a user bubble, each element with its body.
 * `command-args` is listed apart because it carries no attributes.
 */
const HARNESS_TAGS = [
	"system-reminder",
	"task-notification",
	"slack_context",
	"uploaded_files",
	"available-deferred-tools",
	"new-diagnostics",
	"critical_user_preferences_reminder",
	"persisted-output",
	"local-command-caveat",
	"tick",
	"goal",
	"mcp-resource",
	"mcp-resource-update",
	"mcp-polling-update",
	"teammate-message",
	"cross-session-message",
	"launch-selected-element",
	"connected_office_files",
	"thinking",
	"ide_opened_file",
	"ide_selection",
	"ide_diagnostics",
	"browser_instruction",
	"cell",
	"cell_type",
	"language",
	"command-message",
	"no-action-needed",
	"comprehensive-mode-instructions",
	"cu_window_hints",
	"widget_context_hint",
	"preview-annotation-context",
];

/** Upstream's strip pattern: a whole tag element, then any whitespace after it. */
const HARNESS_TAG_RE = new RegExp(
	`<(?:(command-args)|(${HARNESS_TAGS.toSorted((a, b) => b.length - a.length).join("|")})(?=[\\s/>])[^>]*)>[\\s\\S]*?</\\1\\2>\\s*`,
	"g",
);

/** The text with every harness tag element (a teammate message, a system reminder) removed, as upstream shows a user bubble. */
export function stripHarnessTags(text: string): string
{
	return text.replace(HARNESS_TAG_RE, "");
}

/** A prompt's bubble text, without command tags or the harness tags upstream hides; empty when nothing the user typed remains. */
export function cleanPromptText(text: string): string
{
	return stripHarnessTags(stripCommandTags(text)).trim();
}

const BASH_INPUT_RE = /^\s*<bash-input>([\s\S]*?)<\/bash-input>\s*$/;
const BASH_OUTPUT_RE = /^\s*<bash-stdout>([\s\S]*?)<\/bash-stdout>\s*<bash-stderr>([\s\S]*?)<\/bash-stderr>\s*$/;

export function parseBashInput(text: string):
{
	command: string;
} | null
{
	const command = text.match(BASH_INPUT_RE)?.[1];
	return command === undefined
		? null
		:
			{
				command,
			};
}

export function parseBashOutput(text: string):
{
	stdout: string;
	stderr: string;
} | null
{
	const [, stdout, stderr] = text.match(BASH_OUTPUT_RE) ?? [];
	if (stdout === undefined || stderr === undefined) return null;
	return {
		stdout,
		stderr,
	};
}

export function parseCommandBlock(text: string):
{
	name: string;
	args?: string;
} | null
{
	const name = text.match(/<command-name>(.*?)<\/command-name>/)?.[1];
	if (name === undefined) return null;
	const argsMatch = text.match(/<command-args>(.*?)<\/command-args>/s);
	const args = argsMatch?.[1]?.trim();
	const result:
	{
		name: string;
		args?: string;
	} =
	{
		name,
	};
	if (args) result.args = args;
	return result;
}

const ARG_BLOCK_RE = /<(description|instructions|arguments|args|user-request)>([\s\S]*?)<\/\1>/;
const ARG_TAG_RE = /<\/?(?:description|instructions|arguments|args|user-request)>/g;

/**
 * Reduce an expanded slash-command prompt to the user's own words. Command
 * bodies wrap `$ARGUMENTS` in a block such as `<description>`, so that block is
 * the intent and everything around it is template boilerplate. When the user
 * passed no arguments the block is empty and the command's own opening line is
 * the best summary available.
 *
 * Only ever applied to `isMeta` prompts. A command body is injected by the CLI
 * rather than typed, and it carries no markers of its own — the `<command-name>`
 * header lands in a separate record — so `isMeta` is the only signal that these
 * tags are template scaffolding and not something the user pasted.
 */
function stripCommandBoilerplate(text: string): string
{
	const match = text.match(ARG_BLOCK_RE);
	const rawArgs = match?.[2];
	if (match && rawArgs !== undefined)
	{
		const args = rawArgs.trim();
		if (args) return args;

		const openingLine = text.slice(0, match.index).trim().split("\n")[0];
		if (openingLine) return openingLine;
	}
	return text.replace(ARG_TAG_RE, "");
}

const REQUEST_INTERRUPTED_RE = /^\[Request interrupted by user.*\]\s*$/;

/**
 * Whether a user record is the marker the CLI writes in place of the turn the
 * user cut short with ESC. Nothing in it came from the keyboard.
 */
export function isRequestInterrupted(text: string): boolean
{
	return REQUEST_INTERRUPTED_RE.test(text.trim());
}

const SKILL_LAUNCH_RE = /^Base directory for this skill: (\S+)/;
const PLUGIN_SKILL_DIR_RE = /\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/skills\/([^/]+)\/?$/;
const SKILL_ARGUMENTS_RE = /\nARGUMENTS: ([\s\S]*)$/;

/**
 * The words a skill launch body stands for: the arguments the user passed, else
 * the slash command (`/plugin:skill`, `/skill` for a project or user skill).
 * The CLI injects the skill's whole SKILL.md behind its base-directory line, and
 * the slash command record itself carries no title, so this body is all a
 * session started by a bare skill has to be titled by.
 */
function skillLaunchTitle(text: string): string | null
{
	const dir = text.match(SKILL_LAUNCH_RE)?.[1];
	if (dir === undefined) return null;
	const args = text.match(SKILL_ARGUMENTS_RE)?.[1]?.trim();
	if (args) return args;
	const plugin = dir.match(PLUGIN_SKILL_DIR_RE);
	if (plugin) return `/${plugin[1]}:${plugin[2]}`;
	return `/${dir.replace(/\/+$/, "").split("/").pop() ?? ""}`;
}

/** The user's own words, with command scaffolding and line breaks removed. */
function titleText(
	text: string,
	options?:
	{
		isMeta?: boolean;
	},
): string
{
	const command = cleanCommandText(text);
	const skill = options?.isMeta === true ? skillLaunchTitle(command) : null;
	if (skill !== null) return skill.replace(/\s+/g, " ").trim();
	const boilerplateFree = options?.isMeta === true ? stripCommandBoilerplate(command) : command;
	return boilerplateFree.replace(/\s+/g, " ").trim();
}

/**
 * Words that name no work of their own: bare affirmations, acknowledgements,
 * and continuations. A prompt built only from these is an answer to something
 * the assistant asked, not a request.
 */
const CONTINUATION_WORDS = new Set([
	"again",
	"ahead",
	"all",
	"and",
	"any",
	"carry",
	"continue",
	"cool",
	"correct",
	"do",
	"done",
	"exactly",
	"fine",
	"go",
	"going",
	"good",
	"great",
	"hm",
	"hmm",
	"indeed",
	"it",
	"k",
	"keep",
	"more",
	"n",
	"nah",
	"next",
	"nice",
	"no",
	"nope",
	"now",
	"of",
	"ok",
	"okay",
	"on",
	"one",
	"perfect",
	"please",
	"proceed",
	"resume",
	"right",
	"sounds",
	"still",
	"sure",
	"thank",
	"thanks",
	"that",
	"the",
	"them",
	"then",
	"these",
	"this",
	"those",
	"thx",
	"to",
	"try",
	"up",
	"x",
	"y",
	"ya",
	"yeah",
	"yep",
	"yes",
	"you",
	"yup",
]);

/** Shorter than this and a prompt cannot say what a session is for. */
const MIN_INFORMATIVE_LENGTH = 3;

/**
 * Whether a user message says anything about the work a session does. A
 * session resumed or continued opens with the user answering an earlier
 * question -- "yes", "x", "resume" -- and a title built from that record names
 * nothing, so the title falls through to the next message that does.
 *
 * Word matching is deliberately ASCII-only: a prompt written in a script this
 * list cannot spell has no continuation words to find and counts as informative
 * on its length alone.
 */
export function isInformativePrompt(
	text: string,
	options?:
	{
		isMeta?: boolean;
	},
): boolean
{
	const cleaned = titleText(text, options);
	if (cleaned.length < MIN_INFORMATIVE_LENGTH) return false;
	const words = cleaned.toLowerCase().match(/[a-z0-9']+/g);
	if (words === null) return true;
	return !words.every((word) => CONTINUATION_WORDS.has(word));
}

export function extractSessionTitle(
	text: string,
	fallback?: string,
	options?:
	{
		isMeta?: boolean;
	},
): string
{
	const cleaned = titleText(text, options);
	if (!cleaned) return fallback ?? "Untitled Session";

	if (cleaned.length <= 80) return cleaned;

	const truncated = cleaned.slice(0, 80);
	const lastSpace = truncated.lastIndexOf(" ");
	if (lastSpace > 40)
	{
		return truncated.slice(0, lastSpace) + "...";
	}
	return truncated + "...";
}

/**
 * The tools upstream gives their own group-header segment. Every other tool --
 * Skill, ToolSearch, MCP tools, the Task* family, SendMessage, Artifact -- folds
 * into one trailing "used N tools" segment.
 */
const CATEGORY_BY_TOOL =
{
	Read: "read",
	Write: "write",
	Edit: "edit",
	MultiEdit: "edit",
	NotebookEdit: "notebook",
	Bash: "bash",
	PowerShell: "bash",
	Grep: "grep",
	Glob: "glob",
	WebSearch: "websearch",
	WebFetch: "webfetch",
	Agent: "agent",
	Task: "agent",
	TodoWrite: "todo",
} as const;

type ToolCategory = (typeof CATEGORY_BY_TOOL)[keyof typeof CATEGORY_BY_TOOL];

interface SegmentLabel
{
	verb: string;
	/** The rest for a single call or file. */
	one: string;
	/** The rest for several, with `{n}` standing for the count. */
	many: string;
}

const FILE_NOUNS =
{
	one: "a file",
	many: "{n} files",
};

const CATEGORY_LABELS: Record<ToolCategory, SegmentLabel> =
{
	read:
	{
		verb: "Read",
		...FILE_NOUNS,
	},
	write:
	{
		verb: "Created",
		...FILE_NOUNS,
	},
	edit:
	{
		verb: "Edited",
		...FILE_NOUNS,
	},
	notebook:
	{
		verb: "Edited",
		one: "a notebook",
		many: "{n} notebooks",
	},
	bash:
	{
		verb: "Ran",
		one: "a command",
		many: "{n} commands",
	},
	grep:
	{
		verb: "Searched",
		one: "code",
		many: "code",
	},
	glob:
	{
		verb: "Found",
		one: "files",
		many: "files",
	},
	websearch:
	{
		verb: "Browsed",
		one: "the web",
		many: "the web",
	},
	webfetch:
	{
		verb: "Fetched",
		one: "a page",
		many: "{n} pages",
	},
	agent:
	{
		verb: "Ran",
		one: "an agent",
		many: "{n} agents",
	},
	todo:
	{
		verb: "Updated",
		one: "todos",
		many: "todos",
	},
};

const OTHER_TOOLS_LABEL: SegmentLabel =
{
	verb: "Used",
	one: "a tool",
	many: "{n} tools",
};
const RECEIVED_LABEL: SegmentLabel =
{
	verb: "Received",
	one: "a message",
	many: "{n} messages",
};

/** Categories whose calls change a file, so their diff stats sum into the header. */
function isMutation(cat: ToolCategory): boolean
{
	return cat === "edit" || cat === "write";
}

/** Categories that name a file, which collapse into one segment when the group touches only one file. */
const FILE_CATEGORIES: ReadonlySet<ToolCategory> = new Set(["read", "write", "edit", "notebook"]);

function countDiffLines(
	oldStr: string,
	newStr: string,
):
{
	added: number;
	removed: number;
}
{
	if (oldStr === newStr)
		return {
			added: 0,
			removed: 0,
		};
	const oldLines = oldStr === "" ? [] : oldStr.split("\n");
	const newLines = newStr === "" ? [] : newStr.split("\n");
	const oldCounts = new Map<string, number>();
	for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
	const newCounts = new Map<string, number>();
	for (const line of newLines) newCounts.set(line, (newCounts.get(line) ?? 0) + 1);

	let added = 0;
	for (const [line, count] of newCounts)
	{
		const inOld = oldCounts.get(line) ?? 0;
		if (count > inOld) added += count - inOld;
	}
	let removed = 0;
	for (const [line, count] of oldCounts)
	{
		const inNew = newCounts.get(line) ?? 0;
		if (count > inNew) removed += count - inNew;
	}
	return {
		added,
		removed,
	};
}

/** One old/new string pair applied by an `Edit` or `MultiEdit` tool call. */
export interface EditDiffEntry
{
	oldStr: string;
	newStr: string;
}

function asString(value: unknown): string
{
	return typeof value === "string" ? value : "";
}

/**
 * The replacements a file-editing tool call performs, in order. `Edit` carries a
 * single pair at the top level; `MultiEdit` carries an `edits[]` array and falls
 * back to the top-level pair when that array is absent or empty.
 */
export function editDiffEntries(input: Record<string, unknown>): EditDiffEntry[]
{
	const edits = input["edits"];
	if (Array.isArray(edits))
	{
		const entries = edits
			.filter((edit): edit is Record<string, unknown> => typeof edit === "object" && edit !== null)
			.map((edit) => (
			{
				oldStr: asString(edit["old_string"]),
				newStr: asString(edit["new_string"]),
			}));
		if (entries.length > 0) return entries;
	}
	if (typeof input["old_string"] !== "string") return [];
	return [
		{
			oldStr: asString(input["old_string"]),
			newStr: asString(input["new_string"]),
		},
	];
}

export function diffStatsForCall(call: ToolCallLike):
{
	added: number;
	removed: number;
}
{
	const input = call.input;
	// Upstream trusts the result's patch over counting the call's own input.
	const patchStats = call.resultMeta?.patchStats;
	if (patchStats !== undefined && (call.name === "Write" || call.name === "Edit" || call.name === "MultiEdit"))
	{
		return patchStats;
	}
	if (call.name === "Write")
	{
		const content = asString(input["content"]);
		// A final newline ends the last line rather than starting another, as upstream counts it.
		const added = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
		return {
			added,
			removed: 0,
		};
	}
	if (call.name === "Edit" || call.name === "MultiEdit")
	{
		let added = 0;
		let removed = 0;
		for (const entry of editDiffEntries(input))
		{
			const stats = countDiffLines(entry.oldStr, entry.newStr);
			added += stats.added;
			removed += stats.removed;
		}
		return {
			added,
			removed,
		};
	}
	return {
		added: 0,
		removed: 0,
	};
}

/** An MCP tool whose method is exactly `read` (Claude Docs' read), which upstream counts as reading a file. */
const MCP_READ_TOOL = /^mcp__.+__read$/;

function categorize(call: ToolCallLike): ToolCategory | null
{
	if (MCP_READ_TOOL.test(call.name)) return "read";
	return isKeyOf(CATEGORY_BY_TOOL, call.name) ? CATEGORY_BY_TOOL[call.name] : null;
}

export function formatToolName(toolName: string): string
{
	if (toolName.startsWith("mcp__"))
	{
		const withoutPrefix = toolName.slice("mcp__".length);
		const serverName = withoutPrefix.split("__")[0] ?? withoutPrefix;
		if (serverName.startsWith("plugin_"))
		{
			const segments = serverName.split("_");
			return segments.at(-1) ?? serverName;
		}
		return serverName;
	}
	return toolName;
}

function lowercaseFirst(text: string): string
{
	return text.charAt(0).toLowerCase() + text.slice(1);
}

function pluralize(count: number, singular: string, plural: string): string
{
	if (count === 1) return singular;
	return plural.replace("{n}", String(count));
}

/**
 * Extract text from a tool_result content field.
 * Content can be a plain string or an array of {type: 'text', text: string} blocks.
 */
export function extractToolResultContent(content: unknown): string | undefined
{
	if (typeof content === "string") return content;
	if (Array.isArray(content))
	{
		const texts: string[] = [];
		for (const item of content)
		{
			if (isRecord(item) && item["type"] === "text" && typeof item["text"] === "string")
			{
				texts.push(item["text"]);
			}
		}
		return texts.length > 0 ? texts.join("\n") : undefined;
	}
	return undefined;
}

/** An image a tool result returned, as base64 data. */
export interface ToolResultImage
{
	mimeType: string;
	data: string;
}

/** The image types upstream shows as step screenshots (its `Kk` set). */
const TOOL_RESULT_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Extract the base64 images from a tool_result content field, in order: a Read
 * of an image file, a browser screenshot, or any MCP tool returning `image` blocks.
 */
export function extractToolResultImages(content: unknown): ToolResultImage[]
{
	if (!Array.isArray(content)) return [];
	const images: ToolResultImage[] = [];
	for (const item of content)
	{
		if (!isRecord(item) || item["type"] !== "image") continue;
		const source = item["source"];
		if (!isRecord(source) || source["type"] !== "base64") continue;
		const mimeType = source["media_type"];
		const data = source["data"];
		if (typeof mimeType !== "string" || typeof data !== "string") continue;
		if (!TOOL_RESULT_IMAGE_TYPES.has(mimeType)) continue;
		images.push(
			{
				mimeType,
				data,
			},
		);
	}
	return images;
}

/**
 * Strip non-rendering wrapper tags from tool result text.
 */
export function stripResultTags(text: string): string
{
	let result = text;
	result = result.replace(/<\/?tool_use_error>/g, "");
	result = result.replace(/<\/?persisted-output>/g, "");
	result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
	if (result !== text) result = result.trim();
	return result;
}

/**
 * Truncate text to a maximum number of lines, appending a count of omitted lines.
 */
export function truncateResult(text: string, maxLines: number): string
{
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	const truncated = lines.slice(0, maxLines);
	truncated.push(`... (${lines.length - maxLines} more lines)`);
	return truncated.join("\n");
}

/**
 * Structured summary segment: a verb and its rest text, for span-based rendering.
 * Upstream claude.ai/code renders each segment as:
 *   <span class="text-body text-secondary">{verb}</span>
 *   <span class="text-secondary"> {rest}</span>
 */
export interface SummarySegment
{
	verb: string;
	rest: string;
	/**
	 * The group's one file, when this segment names it with no note (c24951e9f
	 * `Te`): a trailing one moves to the header's meta slot as a file link.
	 */
	file?: SummaryFile;
}

/** The file a sole-file segment names; `preferDiff` once a write or edit to it succeeded. */
export interface SummaryFile
{
	path: string;
	preferDiff: boolean;
}

/**
 * Upstream's `j()` (c24951e9f): when the last segment names the group's one
 * file, the phrases stop at its verb ("Ran 2 commands, read") and the name
 * leaves for the row's meta slot.
 */
export function splitTrailingFile(segments: readonly SummarySegment[]):
	|
	  {
			segments: SummarySegment[];
			name: string;
			file: SummaryFile;
	  }
	| undefined
{
	const last = segments.at(-1);
	if (last?.file === undefined) return undefined;
	return {
		segments: [
			...segments.slice(0, -1).map(({verb, rest}) => (
			{
				verb,
				rest,
			})),
			{
				verb: last.verb,
				rest: "",
			},
		],
		name: last.rest,
		file: last.file,
	};
}

/** A background task whose completion notification folded into a tool group. */
export interface BackgroundCompletionLike
{
	/** A `run_in_background` Bash command rather than an agent or monitor. */
	command: boolean;
	status: "completed" | "failed" | "stopped";
	/** The tool_use id of the call that launched the task. */
	toolUseId?: string | null | undefined;
}

/** Agent messages folded into a tool group: those before its first tool, and those after it. */
export interface ReceivedMessages
{
	leading: number;
	trailing: number;
	/** A Stop hook's feedback re-prompted Claude straight into the group's first tool. */
	reprompted?: boolean;
}

const NO_RECEIVED: ReceivedMessages =
{
	leading: 0,
	trailing: 0,
};

/**
 * A summary row's label segments plus what upstream renders beside them: the
 * trailing part its counted line draws unclipped after the phrases (c24951e9f
 * `oe`) -- ", 1 failed", or " and 2 more actions, 1 blocked" -- and the
 * git-coloured `+added -removed` span. `failed` and `blocked` total the whole
 * group's.
 */
export interface ToolCallSummaryStats
{
	segments: SummarySegment[];
	/** The text after the phrases, or null when the label is the bare phrases. */
	trailing: string | null;
	added: number;
	removed: number;
	failed: number;
	blocked: number;
}

/** The group's phrases as text, without the trailing part. */
export function summaryNamesText(segments: readonly SummarySegment[]): string
{
	return segments.map((segment) => (segment.rest ? `${segment.verb} ${segment.rest}` : segment.verb)).join(", ");
}

/** The group header as text: its phrases, then the trailing part. */
export function countedLabelText(stats: Pick<ToolCallSummaryStats, "segments" | "trailing">): string
{
	return `${summaryNamesText(stats.segments)}${stats.trailing ?? ""}`;
}

function basenameFromPath(path: string): string
{
	const lastSlash = path.lastIndexOf("/");
	if (lastSlash === -1) return path;
	return path.slice(lastSlash + 1);
}

function filePathOf(call: ToolCallLike): string | null
{
	const path = call.input["file_path"] ?? call.input["notebook_path"];
	return typeof path === "string" ? path : null;
}

/**
 * The tool's category, except that a Write upstream reports as updating an
 * existing file counts as an edit. The first Write of a path to report either
 * decides for all of them, so a file the group created stays created.
 */
function categorizeWithWrites(calls: ToolCallLike[]): (ToolCategory | null)[]
{
	const firstWriteType = new Map<string, "create" | "update">();
	for (const call of calls)
	{
		const path = filePathOf(call);
		const writeType = call.resultMeta?.writeType;
		if (call.name === "Write" && path !== null && writeType !== undefined && !firstWriteType.has(path))
		{
			firstWriteType.set(path, writeType);
		}
	}
	return calls.map((call) =>
	{
		const cat = categorize(call);
		const path = filePathOf(call);
		return cat === "write" && path !== null && firstWriteType.get(path) === "update" ? "edit" : cat;
	});
}

/**
 * The one file every file call in the group touched, or null when some call
 * named none or they touched several. Upstream then names the file instead of
 * counting: "Read and edited cache.ts", never "Read a.ts, edited b.ts".
 */
function soleFilePath(calls: ToolCallLike[], categories: (ToolCategory | null)[]): string | null
{
	const paths = new Set<string>();
	for (const [index, call] of calls.entries())
	{
		const cat = categories[index];
		if (cat === null || cat === undefined || !FILE_CATEGORIES.has(cat)) continue;
		const path = filePathOf(call);
		if (path === null) return null;
		paths.add(path);
	}
	return paths.size === 1 ? ([...paths][0] ?? null) : null;
}

const VERB_LIST = new Intl.ListFormat(
	"en",
	{
		type: "conjunction",
	},
);

/** Upstream's per-call outcome (c24951e9f `X`), less the pending and held ones local never counts. */
type CallOutcome = "succeeded" | "failed" | "stopped" | "blocked";

/**
 * What upstream counts once in a segment: the file a call touches, so three
 * edits of one file are "Edited a.ts", or else the call itself. Each key keeps
 * the outcome of its last call, so a failed edit retried successfully is no
 * failure.
 */
function callKey(call: ToolCallLike, index: number): string
{
	const path = filePathOf(call);
	if (path !== null) return `path:${path}`;
	return call.id === undefined ? `index:${index}` : `id:${call.id}`;
}

/**
 * A call the user rejected or interrupted is "stopped" and one the auto-mode
 * classifier refused is "blocked" (c06cf64bb `Cl`/`qc`): upstream counts both
 * in the segment but neither as a failure.
 */
function callOutcome(call: ToolCallLike, failedLaunches: ReadonlySet<string>): CallOutcome
{
	if (call.stopped === true || call.denied === true) return "stopped";
	if (call.blocked === true) return "blocked";
	// Upstream settles a benign error (`errorIsBenign`) done, so it is no failure.
	if (isBenignToolError(call)) return "succeeded";
	const failedLaunch = call.id !== undefined && failedLaunches.has(call.id);
	return call.isError === true || failedLaunch ? "failed" : "succeeded";
}

/**
 * Upstream's per-key merge (c24951e9f `Z`): a stopped retry keeps the key's
 * earlier outcome, so only a key whose every call stopped reads stopped; any
 * other outcome replaces it.
 */
function mergeOutcome(prev: CallOutcome | undefined, next: CallOutcome): CallOutcome | undefined
{
	return next === "stopped" && prev !== undefined ? prev : next;
}

function countOutcome(byKey: Map<string, CallOutcome | undefined>, outcome: CallOutcome): number
{
	let count = 0;
	for (const keyOutcome of byKey.values()) if (keyOutcome === outcome) count++;
	return count;
}

/** The calls, files, or verbs in a segment that failed, stopped, or were blocked. */
interface SegmentOutcomes
{
	failed: number;
	stopped: number;
	blocked: number;
}

const NO_OUTCOMES: SegmentOutcomes =
{
	failed: 0,
	stopped: 0,
	blocked: 0,
};

function keyOutcomes(byKey: Map<string, CallOutcome | undefined>): SegmentOutcomes
{
	return {
		failed: countOutcome(byKey, "failed"),
		stopped: countOutcome(byKey, "stopped"),
		blocked: countOutcome(byKey, "blocked"),
	};
}

/**
 * A segment before its outcome notes, with the actions it stands for -- files,
 * calls, or verbs -- so a capped header can total the ones it drops.
 */
interface CountedSegment extends SummarySegment, SegmentOutcomes
{
	count: number;
}

/**
 * One segment for every file call when they all touched one file: the verbs in
 * the order first used, then its name -- "Read, edited, and created x.ts" --
 * with one failure, stop, or block per verb that holds one (upstream `A`).
 */
function soleFileSegment(
	path: string,
	outcomes: Map<ToolCategory, Map<string, CallOutcome | undefined>>,
	link:
	{
		linkable: boolean;
		preferDiff: boolean;
	},
): CountedSegment
{
	const byVerb = new Map<string, Set<CallOutcome | undefined>>();
	for (const [cat, byKey] of outcomes)
	{
		if (!FILE_CATEGORIES.has(cat)) continue;
		const verb = CATEGORY_LABELS[cat].verb.toLowerCase();
		byVerb.set(verb, new Set([...(byVerb.get(verb) ?? []), ...byKey.values()]));
	}
	const verbsHolding = (outcome: CallOutcome) => [...byVerb.values()].filter((held) => held.has(outcome)).length;
	const verbs = VERB_LIST.format(byVerb.keys());
	const segment: CountedSegment =
	{
		verb: verbs.charAt(0).toUpperCase() + verbs.slice(1),
		rest: basenameFromPath(path),
		count: byVerb.size,
		failed: verbsHolding("failed"),
		stopped: verbsHolding("stopped"),
		blocked: verbsHolding("blocked"),
	};
	if (link.linkable && !SUSPECT_PATH_CHARS.test(path))
		segment.file =
		{
			path,
			preferDiff: link.preferDiff,
		};
	return segment;
}

/** The tools whose sole file upstream links (c24951e9f `b`). */
const FILE_LINK_TOOLS: ReadonlySet<string> = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** Control, format, or invisible characters in a path, which upstream never links (`gL`). */
const SUSPECT_PATH_CHARS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

/**
 * Whether the group's file calls may link their sole file -- every one a
 * file-editing built-in -- and whether a write, edit, or notebook edit of it
 * succeeded, so upstream opens the diff.
 */
function soleFileLink(
	calls: ToolCallLike[],
	categories: (ToolCategory | null)[],
	failedLaunches: ReadonlySet<string>,
):
{
	linkable: boolean;
	preferDiff: boolean;
}
{
	let linkable = true;
	let preferDiff = false;
	for (const [index, call] of calls.entries())
	{
		const cat = categories[index];
		if (cat === null || cat === undefined || !FILE_CATEGORIES.has(cat)) continue;
		if (!FILE_LINK_TOOLS.has(call.name)) linkable = false;
		if (cat !== "read" && callOutcome(call, failedLaunches) === "succeeded") preferDiff = true;
	}
	return {
		linkable,
		preferDiff,
	};
}

function labelledSegment(label: SegmentLabel, count: number, outcomes: SegmentOutcomes = NO_OUTCOMES): CountedSegment
{
	return {
		verb: label.verb,
		rest: pluralize(count, label.one, label.many),
		count,
		...outcomes,
	};
}

/**
 * A segment's inline note (c24951e9f `ye`): a block wins and drops any stop,
 * "(1 failed, 1 blocked)"; else stops and failures, "(1 failed, 1 stopped)".
 */
function inlineNote({failed, stopped, blocked}: SegmentOutcomes): string | null
{
	if (blocked > 0) return failed > 0 ? `(${failed} failed, ${blocked} blocked)` : `(${blocked} blocked)`;
	if (stopped > 0) return failed > 0 ? `(${failed} failed, ${stopped} stopped)` : `(${stopped} stopped)`;
	return failed > 0 ? `(${failed} failed)` : null;
}

/** The note left inline when failures and blocks trail (`plainMeta`): only an unblocked segment's stops. */
function plainNote({stopped, blocked}: SegmentOutcomes): string | null
{
	return blocked === 0 && stopped > 0 ? `(${stopped} stopped)` : null;
}

/** Upstream's outcomes part (`V`): "1 failed", "1 blocked", or "1 failed, 1 blocked". */
function outcomesText(failed: number, blocked: number): string | null
{
	const parts = [failed > 0 ? `${failed} failed` : null, blocked > 0 ? `${blocked} blocked` : null];
	const shown = parts.filter((part) => part !== null);
	return shown.length > 0 ? shown.join(", ") : null;
}

function withNote(segment: CountedSegment, note: string | null): SummarySegment
{
	if (note === null)
	{
		// Upstream links the file only while its meta is undecorated and nothing on it failed or was blocked.
		const clean = segment.failed === 0 && segment.blocked === 0;
		return clean && segment.file !== undefined
			?
				{
					verb: segment.verb,
					rest: segment.rest,
					file: segment.file,
				}
			:
				{
					verb: segment.verb,
					rest: segment.rest,
				};
	}
	return {
		verb: segment.verb,
		rest: segment.rest ? `${segment.rest} ${note}` : note,
	};
}

/** Segments upstream shows before folding the rest into "and N more actions". */
const SHOWN_SEGMENTS = 3;

/**
 * Upstream's trailing mode (c24951e9f `oe`, which transcript groups always
 * use). Five or more segments keep the first three, the last ending in ",",
 * and trail "and N more actions" plus the whole group's failures and blocks:
 * "Ran a command, searched code, found files, and 2 more actions, 1 failed".
 * Two to four with a failure or block trail the outcomes part: "Ran 2
 * commands, read a file, 1 failed". Otherwise each segment keeps its note
 * inline: "Ran 3 commands (1 failed, 1 stopped)". Trailing segments keep only
 * their stops inline.
 */
function shapeSegments(segments: CountedSegment[]):
{
	segments: SummarySegment[];
	trailing: string | null;
}
{
	const outcomes = outcomesText(
		segments.reduce((sum, segment) => sum + segment.failed, 0),
		segments.reduce((sum, segment) => sum + segment.blocked, 0),
	);
	if (segments.length >= SHOWN_SEGMENTS + 2)
	{
		const count = segments.slice(SHOWN_SEGMENTS).reduce((sum, segment) => sum + segment.count, 0);
		const shown = segments
			.slice(0, SHOWN_SEGMENTS)
			.map(({file: _file, ...segment}) => withNote(segment, plainNote(segment)));
		const last = shown.at(-1);
		if (last !== undefined)
		{
			if (last.rest) last.rest = `${last.rest},`;
			else last.verb = `${last.verb},`;
		}
		const more = pluralize(count, "1 more action", "{n} more actions");
		return {
			segments: shown,
			trailing: ` and ${more}${outcomes === null ? "" : `, ${outcomes}`}`,
		};
	}
	if (segments.length > 1 && outcomes !== null)
	{
		return {
			segments: segments.map(({file: _file, ...segment}) => withNote(segment, plainNote(segment))),
			trailing: `, ${outcomes}`,
		};
	}
	return {
		segments: segments.map((segment) => withNote(segment, inlineNote(segment))),
		trailing: null,
	};
}

/**
 * Upstream fails a launch in this group whose background task failed, "Ran 2
 * commands, finished a background command (1 failed)", and settles as many
 * failed completions in the group, whichever launch each one reports, so they
 * stop leading the label.
 */
function attributeLaunchFailures(
	calls: ToolCallLike[],
	completions: readonly BackgroundCompletionLike[],
	failedLaunches: ReadonlySet<string>,
):
{
	completions: BackgroundCompletionLike[];
	failedLaunches: ReadonlySet<string>;
}
{
	const callIds = new Set(calls.flatMap((call) => (call.id === undefined ? [] : [call.id])));
	const launches = new Set(failedLaunches);
	for (const {status, toolUseId} of completions)
	{
		if (status === "failed" && toolUseId != null && callIds.has(toolUseId)) launches.add(toolUseId);
	}
	let toSettle = calls.filter(
		(call) => call.isError !== true && call.id !== undefined && launches.has(call.id),
	).length;
	const settled = completions.map((completion) =>
	{
		if (completion.status !== "failed" || toSettle === 0) return completion;
		toSettle--;
		return {
			...completion,
			status: "completed" as const,
		};
	});
	return {
		completions: settled,
		failedLaunches: launches,
	};
}

function buildSummarySegments(
	calls: ToolCallLike[],
	groupCompletions: readonly BackgroundCompletionLike[] = [],
	knownFailedLaunches: ReadonlySet<string> = new Set(),
	received: ReceivedMessages = NO_RECEIVED,
): ToolCallSummaryStats
{
	const {completions, failedLaunches} = attributeLaunchFailures(calls, groupCompletions, knownFailedLaunches);
	// Insertion order carries the summary order: upstream Normal writes both
	// "Updated todos, read 3 files" and "Read index.ts, updated todos", so
	// segments follow the order each tool was first called.
	const outcomes = new Map<ToolCategory, Map<string, CallOutcome | undefined>>();
	let otherTools = 0;
	// Upstream's generic bucket notes failures and blocks only (`z`), never stops.
	const otherOutcomes =
	{
		...NO_OUTCOMES,
	};
	let added = 0;
	let removed = 0;

	const categories = categorizeWithWrites(calls);
	calls.forEach((call, index) =>
	{
		const cat = categories[index] ?? null;
		const outcome = callOutcome(call, failedLaunches);
		if (cat === null)
		{
			otherTools++;
			if (outcome === "failed") otherOutcomes.failed++;
			if (outcome === "blocked") otherOutcomes.blocked++;
			return;
		}
		let byKey = outcomes.get(cat);
		if (byKey === undefined)
		{
			byKey = new Map();
			outcomes.set(cat, byKey);
		}
		const key = callKey(call, index);
		byKey.set(key, mergeOutcome(byKey.get(key), outcome));
		// A failed edit changed nothing, so upstream leaves it out of the totals.
		if (isMutation(cat) && call.isError !== true)
		{
			const s = diffStatsForCall(call);
			added += s.added;
			removed += s.removed;
		}
	});

	// Each segment counts its own outcomes, which shapeSegments notes inline or totals in the trailing part.
	const segments: CountedSegment[] = [];
	const solePath = soleFilePath(calls, categories);
	const link = soleFileLink(calls, categories, failedLaunches);
	let soleFileNamed = false;
	for (const [cat, byKey] of outcomes)
	{
		if (solePath !== null && FILE_CATEGORIES.has(cat))
		{
			if (!soleFileNamed) segments.push(soleFileSegment(solePath, outcomes, link));
			soleFileNamed = true;
			continue;
		}
		segments.push(labelledSegment(CATEGORY_LABELS[cat], byKey.size, keyOutcomes(byKey)));
	}

	if (otherTools > 0) segments.push(labelledSegment(OTHER_TOOLS_LABEL, otherTools, otherOutcomes));

	// Upstream names agent messages where they arrived: "Received a message, ran
	// a command" when they led the run, "Ran 2 commands, received a message" after.
	if (received.leading > 0) segments.unshift(labelledSegment(RECEIVED_LABEL, received.leading));
	if (received.trailing > 0) segments.push(labelledSegment(RECEIVED_LABEL, received.trailing));
	// Upstream leads with the re-prompt that started the run: "Hook re-prompted Claude, ran a command".
	if (received.reprompted === true)
		segments.unshift(
			{
				verb: "Hook",
				rest: "re-prompted Claude",
				count: 1,
				...NO_OUTCOMES,
			},
		);

	// Upstream folds background completions in last: "Ran a command, finished
	// a background command", "Used a tool, finished a background task (1 stopped)",
	// but leads with them when one failed: "Finished a background command, ran a
	// command (1 failed)". A group mixing failed and stopped completions is unobserved.
	if (completions.length > 0)
	{
		const noun = completions.every((completion) => completion.command) ? "command" : "task";
		const stopped = completions.filter((completion) => completion.status === "stopped").length;
		const failedCompletions = completions.filter((completion) => completion.status === "failed").length;
		const rest = pluralize(completions.length, `a background ${noun}`, `{n} background ${noun}s`);
		const count = completions.length;
		if (failedCompletions > 0)
		{
			segments.unshift(
				{
					verb: "Finished",
					rest,
					count,
					...NO_OUTCOMES,
					failed: failedCompletions,
				},
			);
		}
		else
		{
			segments.push(
				{
					verb: "Finished",
					rest,
					count,
					...NO_OUTCOMES,
					stopped,
				},
			);
		}
	}

	const shaped = shapeSegments(segments);
	// Upstream capitalizes only the leading verb: "Ran 2 commands, read cache.ts".
	return {
		segments: shaped.segments.map((segment, i) => (
		{
			...segment,
			verb: i === 0 ? segment.verb : lowercaseFirst(segment.verb),
		})),
		trailing: shaped.trailing,
		added,
		removed,
		failed: segments.reduce((sum, segment) => sum + segment.failed, 0),
		blocked: segments.reduce((sum, segment) => sum + segment.blocked, 0),
	};
}

/**
 * `failedLaunches` holds the tool_use ids of background launches whose task
 * later failed, wherever its notification landed; upstream counts each as a
 * failed call.
 */
export function summarizeToolCallStats(
	calls: ToolCallLike[],
	completions: readonly BackgroundCompletionLike[] = [],
	failedLaunches: ReadonlySet<string> = new Set(),
	received: ReceivedMessages = NO_RECEIVED,
): ToolCallSummaryStats
{
	return buildSummarySegments(calls, completions, failedLaunches, received);
}

export function summarizeToolCallsStructured(calls: ToolCallLike[]): SummarySegment[]
{
	if (calls.length === 0) return [];
	return buildSummarySegments(calls).segments;
}

/** Upstream shows both counts whenever either is non-zero: "+0 -28". */
export function hasDiffStats(stats: {added: number; removed: number}): boolean
{
	return stats.added > 0 || stats.removed > 0;
}

export function summarizeToolCalls(calls: ToolCallLike[]): string
{
	const summary = buildSummarySegments(calls);
	const names = summary.segments.map((s) => `${lowercaseFirst(s.verb)} ${s.rest}`.trimEnd()).join(", ");
	const label = `${names}${summary.trailing ?? ""}`;
	return hasDiffStats(summary) ? `${label} +${summary.added} -${summary.removed}` : label;
}
