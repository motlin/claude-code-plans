import {z} from "zod";
import {isRequestInterrupted} from "./session-utils";
import {assertNever} from "./assert-never";
import type {SessionSummaryState} from "./session-state";
import {cutUnterminatedPrivateKey, maskSecretsFixed} from "./secret-mask";
import {formatElapsed} from "./elapsed-format";

/**
 * One signal in a session's current turn, normalized from transcript records
 * and live hook state. `progress` is any response that is not a tool call:
 * it ends a tool's activity label, any pending API retry and any thinking.
 * `thinking` is an assistant record whose last block is a thinking block.
 */
export type WorkingMarkerEvent =
	|
	  {
			kind: "prompt";
			at: number;
	  }
	|
	  {
			kind: "tool";
			at: number;
			label: string;
	  }
	|
	  {
			kind: "progress";
			at: number;
	  }
	|
	  {
			kind: "thinking";
			at: number;
	  }
	|
	  {
			kind: "retry";
			at: number;
			attempt: number;
			maxRetries: number;
			error: string;
	  }
	|
	  {
			kind: "interrupt";
			at: number;
	  }
	|
	  {
			kind: "stop";
			at: number;
	  };

/** Upstream claude.ai/code's transcript tail marker (busy / stopping / retrying / hidden). */
export type WorkingMarkerState =
	|
	  {
			status: "idle";
	  }
	|
	  {
			status: "stopping";
	  }
	/** Blocked on a tool permission prompt: a still spark with no status text. */
	|
	  {
			status: "waiting";
	  }
	|
	  {
			status: "working";
			label: string;
			thinking: boolean;
			/** Any response has landed since the turn's prompt; until then upstream says "Waiting for Claude…". */
			replied: boolean;
			turnStartedAt: number;
			elapsedSeconds: number;
	  }
	|
	  {
			status: "retrying";
			error: string;
			attempt: number;
			maxRetries: number;
			turnStartedAt: number;
			elapsedSeconds: number;
	  };

const WORKING_LABEL = "Working…";

interface Turn
{
	startedAt: number;
	label: string;
	retry:
	{
		attempt: number;
		maxRetries: number;
		error: string;
	} | null;
	stopping: boolean;
	thinking: boolean;
	replied: boolean;
}

export function workingMarkerState(events: readonly WorkingMarkerEvent[], now: number): WorkingMarkerState
{
	let turn: Turn | null = null;
	for (const event of events)
	{
		if (event.kind === "prompt")
		{
			turn =
			{
				startedAt: event.at,
				label: WORKING_LABEL,
				retry: null,
				stopping: false,
				thinking: false,
				replied: false,
			};
			continue;
		}
		if (turn === null) continue;
		switch (event.kind)
		{
			case "tool":
				turn =
				{
					...turn,
					label: event.label,
					retry: null,
					thinking: false,
					replied: true,
				};
				break;
			case "progress":
				turn =
				{
					...turn,
					label: WORKING_LABEL,
					retry: null,
					thinking: false,
					replied: true,
				};
				break;
			case "thinking":
				turn =
				{
					...turn,
					label: WORKING_LABEL,
					retry: null,
					thinking: true,
					replied: true,
				};
				break;
			case "retry":
				turn =
				{
					...turn,
					retry:
					{
						attempt: event.attempt,
						maxRetries: event.maxRetries,
						error: event.error,
					},
				};
				break;
			case "interrupt":
				turn =
				{
					...turn,
					stopping: true,
				};
				break;
			case "stop":
				turn = null;
				break;
		}
	}

	if (turn === null)
		return {
			status: "idle",
		};
	if (turn.stopping)
		return {
			status: "stopping",
		};
	const elapsedSeconds = Math.max(0, Math.floor((now - turn.startedAt) / 1000));
	if (turn.retry !== null)
	{
		return {
			status: "retrying",
			...turn.retry,
			turnStartedAt: turn.startedAt,
			elapsedSeconds,
		};
	}
	return {
		status: "working",
		label: turn.label,
		thinking: turn.thinking,
		replied: turn.replied,
		turnStartedAt: turn.startedAt,
		elapsedSeconds,
	};
}

const THINKING_STAT = "Thinking";

/** Upstream shows a live elapsed clock only from 2s (`R=u>=2?u:void 0`). */
export const ELAPSED_MIN_SECONDS = 2;

function liveElapsedStats(elapsedSeconds: number): string[]
{
	return elapsedSeconds < ELAPSED_MIN_SECONDS ? [] : [formatElapsed(elapsedSeconds)];
}

/**
 * Upstream's shared-8 `Jt`: one decimal kept ("1.0k", "50.0k"), uppercase M/B, and a unit that would read
 * "1000.0" rolls over to the next one.
 */
function formatCompactTokenCount(tokens: number): string
{
	if (tokens >= 1e9) return `${(tokens / 1e9).toFixed(1)}B`;
	if (tokens >= 1e6)
	{
		const millions = Number((tokens / 1e6).toFixed(1));
		return millions >= 1000 ? `${(tokens / 1e9).toFixed(1)}B` : `${millions.toFixed(1)}M`;
	}
	if (tokens >= 1e3)
	{
		const thousands = Number((tokens / 1e3).toFixed(1));
		return thousands >= 1000 ? `${(tokens / 1e6).toFixed(1)}M` : `${thousands.toFixed(1)}k`;
	}
	return String(tokens);
}

/** Upstream's token stat (`q6`): "1 token", else "{n} tokens" with the compact count ("50.2k tokens"). */
export function formatTokenEstimate(tokens: number): string
{
	if (tokens === 1) return "1 token";
	return `${formatCompactTokenCount(tokens)} tokens`;
}

/** Which segment a working-line stat is, for upstream's stable segment keys ("elapsed", "tokens", "thinking"). */
export type WorkingStatKey = "elapsed" | "tokens" | "thinking";

export function workingStatKey(stat: string): WorkingStatKey
{
	if (stat === THINKING_STAT) return "thinking";
	return stat.endsWith(" tokens") || stat === "1 token" ? "tokens" : "elapsed";
}

/** Upstream shows the token stat with the clock (from 2s) and only once the count is non-zero. */
function tokenStats(elapsedSeconds: number, tokens: number): string[]
{
	return elapsedSeconds < ELAPSED_MIN_SECONDS || tokens <= 0 ? [] : [formatTokenEstimate(tokens)];
}

/**
 * Whether the working line goes quiet because the transcript draws the
 * in-flight call as its own busy row: upstream keeps the line mounted but
 * invisible, so there is no second status line. Stopping and retrying still show.
 */
export function tailMarkerQuiet(state: WorkingMarkerState, inFlightRow: boolean): boolean
{
	return inFlightRow && state.status === "working";
}

/**
 * Whether the working line says "Needs your input": upstream's `sayWaiting`
 * shows the blocked status only while a permission or question waits and no
 * inline card holds the mark.
 */
export function workingLineWaitsOnUser({
	awaitingPermission,
	sessionState,
	cardShown,
}: Readonly<
{
	awaitingPermission: boolean;
	sessionState: SessionSummaryState | null;
	cardShown: boolean;
}>): boolean
{
	return (awaitingPermission || sessionState === "waiting") && !cardShown;
}

/**
 * The working line under a live inline card: upstream hides the transcript loader for any live card
 * (`hideLoader: vs`), so the tail grid's line (`Vt`) mounts only while the tab is responding, as the blocked
 * "Needs your input" line, or as an empty line under a plan-exit card. `null` when no card is shown, so the
 * usual line rules apply.
 */
export function workingLineUnderCard({
	cardShown,
	respondingHere,
	planCard,
}: Readonly<
{
	cardShown: boolean;
	respondingHere: boolean;
	/** The shown card is a plan-exit card, with no question, permission or elicitation card waiting. */
	planCard: boolean;
}>): "none" | "blocked" | "empty" | null
{
	if (!cardShown) return null;
	if (!respondingHere) return "none";
	return planCard ? "empty" : "blocked";
}

/**
 * A row's running words handed to the working line when the row cannot hold
 * the mark (upstream's `toolLabel`/`toolLabelUnspoken`/`toolLabelSince`).
 * `unspoken` words come from a grouped step, so the line announces them;
 * `since` is the call's clock start (`toolLabelSince`), null for the turn's.
 */
export interface WorkingLineToolLabel
{
	words: string;
	unspoken: boolean;
	since: number | null;
}

/** Upstream's working-activity label (`ct`): every secret becomes seven bullets, then an unterminated private key is cut. */
export function maskWorkingLabel(words: string): string
{
	return cutUnterminatedPrivateKey(maskSecretsFixed(words));
}

/** What the busy line's label shows, in upstream's `h ?? toolLabel` priority. */
export type WorkingLineLabelSource = "stopping" | "retry" | "phase" | "tool" | "stats";

export function workingLineLabelSource({
	state,
	phase,
	toolLabel,
}: Readonly<
{
	state: WorkingMarkerState;
	phase: string | null;
	toolLabel: WorkingLineToolLabel | null;
}>): WorkingLineLabelSource
{
	if (state.status === "stopping") return "stopping";
	if (state.status === "retrying") return "retry";
	if (phase !== null) return "phase";
	return toolLabel !== null && state.status === "working" ? "tool" : "stats";
}

/** One permission-wait interval; `to` is null while it is still open. */
export interface PermissionWait
{
	from: number;
	to: number | null;
}

/** Upstream's `waitedMsSince`: the permission-wait time after `since`, an open wait counting nothing. */
export function waitedMsSince(waits: readonly PermissionWait[], since: number): number
{
	return waits.reduce((sum, {from, to}) => sum + Math.max(0, (to ?? from) - Math.max(from, since)), 0);
}

/** Upstream's `bSe`: the call clock starts at the call (never before the turn), pushed on by its permission waits. */
export function toolLabelSince({
	callStartedAt,
	turnStartedAt,
	waits,
}: Readonly<
{
	callStartedAt: number | null;
	turnStartedAt: number;
	waits: readonly PermissionWait[];
}>): number
{
	const start = Math.max(callStartedAt ?? turnStartedAt, turnStartedAt);
	return start + waitedMsSince(waits, start);
}

/** Upstream's `clockNotBefore = toolLabelEndedAt + 2e3`: no clock for 2s after a call's words clear. */
export const TOOL_CLOCK_HOLD_MS = 2000;

export function clockHidden({
	now,
	endedAt,
}: Readonly<
{
	now: number;
	endedAt: number | null;
}>): boolean
{
	return endedAt !== null && now < endedAt + TOOL_CLOCK_HOLD_MS;
}

/**
 * The working line's stats while a tool's words show: the call clock (from 2s)
 * and the token stat, never the Thinking word.
 */
export function toolLabelStats(
	state: Extract<
		WorkingMarkerState,
		{
			status: "working";
		}
	>,
	since: number | null,
	tokens: number,
): string[]
{
	const now = state.turnStartedAt + state.elapsedSeconds * 1000;
	const elapsed = Math.max(0, Math.floor((now - (since ?? state.turnStartedAt)) / 1000));
	return [...liveElapsedStats(elapsed), ...tokenStats(elapsed, tokens)];
}

/** Upstream's settle (`TTe`) before one phase word swaps for the next. */
export const PHASE_SETTLE_MS = 150;

/** Upstream's `l8` "connecting" word, standing in for a waiting phase while the event stream is down. */
export const CONNECTING_PHASE_LABEL = "Connecting…";

/**
 * Upstream's `e2` (shared-frame): a busy label drops trailing whitespace and format characters, then
 * every trailing "…" or run of 3+ dots. With nothing stripped, or nothing left, the label stays as written.
 */
export function stripBusyEllipsis(label: string): string
{
	let end = label.length;
	while (end > 0 && /[\s\p{Cf}]/u.test(label.charAt(end - 1))) end--;
	let cut = end;
	while (cut > 0)
	{
		const last = label.charAt(cut - 1);
		if (last === "…")
		{
			cut--;
			continue;
		}
		if (last !== ".") break;
		let dots = cut;
		while (dots > 0 && label[dots - 1] === ".") dots--;
		if (cut - dots < 3) break;
		cut = dots;
	}
	const stripped = cut === end ? label : label.slice(0, cut);
	return stripped.trim() === "" ? label : stripped;
}

/**
 * Upstream's `mz` (shared-frame): line and tab breaks become one space, and control, format, separator,
 * default-ignorable, blank-looking and noncharacter code points are dropped (ZWNJ, ZWJ, VS15, VS16 kept;
 * a lone high surrogate kept).
 */
function normalizeLabelText(text: string): string
{
	return text
		.replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/g, " ")
		.replace(
			/[\uD800-\uDBFF]*(?:(?!\u200C|\u200D|\uFE0E|\uFE0F)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}\uFDD0-\uFDEF\uFFFE\uFFFF\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}])[\uDC00-\uDFFF]*|([\uD800-\uDBFF]+)/gu,
			"$1",
		);
}

/** Upstream's TurnStatus states, the first half of a MorphSlot swap key. */
export type TurnStatusState = "pending" | "busy" | "blocked" | "done" | "failed" | "stopped" | "denied";

/**
 * Upstream's `pP` (shared-frame): a TurnStatus label's MorphSlot key. A text label keys by state and its
 * normalized text (a busy label without its ellipsis); any other label keys by state alone.
 */
export function turnStatusSwapKey(state: TurnStatusState, label: unknown): string
{
	return typeof label === "string"
		? `${state}|${normalizeLabelText(state === "busy" ? stripBusyEllipsis(label) : label)}`
		: `${state}|`;
}

/**
 * Upstream's pre-stream phase word (`l8`): "Sending…" while a live-pane
 * prompt is on its way to the transcript, then "Waiting for Claude…" from the
 * turn's prompt until its first response. Null once Claude has replied.
 */
export function phaseLabel({
	sending,
	promptSeen,
	firstAssistantSeen,
}: Readonly<
{
	sending: boolean;
	promptSeen: boolean;
	firstAssistantSeen: boolean;
}>): string | null
{
	if (promptSeen) return firstAssistantSeen ? null : "Waiting for Claude…";
	return sending ? "Sending…" : null;
}

/** The working line's visible pieces: an optional label, then "·"-joined stats. */
export interface WorkingLineParts
{
	label: string;
	stats: string[];
}

/**
 * `tokens` is the turn's token estimate (`turnTokenEstimate`), shown only while working.
 * `showClock` false drops the elapsed clock (upstream's 2s hold after a call's words clear).
 */
export function workingLineParts(state: WorkingMarkerState, tokens = 0, showClock = true): WorkingLineParts
{
	switch (state.status)
	{
		case "idle":
		case "waiting":
			return {
				label: "",
				stats: [],
			};
		case "stopping":
			// Upstream's e2() strips the trailing ellipsis: "Stopping", with no clock.
			return {
				label: "Stopping",
				stats: [],
			};
		case "working":
			// Upstream's order is "{elapsed} · {tokens} · Thinking", with Thinking a plain stat while a thinking block streams.
			return {
				label: "",
				stats: [
					...(showClock ? liveElapsedStats(state.elapsedSeconds) : []),
					...tokenStats(state.elapsedSeconds, tokens),
					...(state.thinking ? [THINKING_STAT] : []),
				],
			};
		case "retrying":
			return {
				label: retryLabel(state),
				stats: showClock ? liveElapsedStats(state.elapsedSeconds) : [],
			};
		default:
			return assertNever(state);
	}
}

export function workingMarkerText(state: WorkingMarkerState, tokens = 0): string
{
	const {label, stats} = workingLineParts(state, tokens);
	return [label, ...stats].filter((part) => part !== "").join(" · ");
}

/** The polite sr-only status: upstream announces "Working…", never the ticking clock. */
export function workingLineAnnouncement(state: WorkingMarkerState): string
{
	switch (state.status)
	{
		case "idle":
		case "waiting":
			return "";
		case "working":
			return WORKING_LABEL;
		case "stopping":
		case "retrying":
			return workingLineParts(state).label;
		default:
			return assertNever(state);
	}
}

function basename(path: string): string
{
	return path.split(/[\\/]/).pop() ?? path;
}

function hostname(url: string): string
{
	try
	{
		return new URL(url).hostname;
	}
	catch
	{
		return url;
	}
}

const ToolInputFieldsSchema = z.object(
	{
		file_path: z.string().optional(),
		pattern: z.string().optional(),
		description: z.string().optional(),
		url: z.string().optional(),
	},
);

/** The status-line label for a running tool; `input` is unknown for hook-only pending tools. */
export function toolActivityLabel(name: string, input: unknown): string
{
	const parsed = ToolInputFieldsSchema.safeParse(input);
	const fields = parsed.success ? parsed.data : {};
	const file = fields.file_path === undefined ? "file" : basename(fields.file_path);
	switch (name)
	{
		case "Read":
			return `Reading ${file}`;
		case "Edit":
		case "MultiEdit":
		case "NotebookEdit":
			return `Editing ${file}`;
		case "Write":
			return `Writing ${file}`;
		case "Grep":
			return fields.pattern === undefined ? "Searching" : `Searching for ${fields.pattern}`;
		case "Glob":
			return "Finding files";
		case "Bash":
			return fields.description ?? "Running command";
		case "WebFetch":
			return fields.url === undefined ? "Fetching" : `Fetching ${hostname(fields.url)}`;
		case "WebSearch":
			return "Searching the web";
		case "Agent":
		case "Task":
			return fields.description ?? "Running agent";
		default:
			return `Using ${name}`;
	}
}

const ContentBlockSchema = z.object(
	{
		type: z.string(),
		text: z.string().optional(),
		thinking: z.string().optional(),
		content: z.unknown().optional(),
		name: z.string().optional(),
		input: z.unknown().optional(),
	},
);

const MarkerRecordSchema = z.object(
	{
		type: z.string(),
		subtype: z.string().optional(),
		timestamp: z.string().optional(),
		isMeta: z.boolean().optional(),
		isSidechain: z.boolean().optional(),
		isCompactSummary: z.boolean().optional(),
		retryAttempt: z.number().optional(),
		maxRetries: z.number().optional(),
		retryInMs: z.number().optional(),
		error: z.unknown().optional(),
		message: z
			.object(
				{
					content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
				},
			)
			.optional(),
	},
);

type MarkerRecord = z.infer<typeof MarkerRecordSchema>;

const ErrorObjectSchema = z.object(
	{
		status: z.number().optional(),
		formatted: z.string().optional(),
		message: z.string().optional(),
	},
);

const NO_RESPONSE = "No response from the API";

/** Upstream's short retry phrases (`je`/`xO`), matched on the HTTP status or the error text. */
function errorHeadline(error: unknown): string
{
	const parsed = ErrorObjectSchema.safeParse(error);
	const status = parsed.success ? parsed.data.status : undefined;
	const raw = typeof error === "string" ? error : error === undefined ? "" : JSON.stringify(error);
	const text = raw.toLowerCase();
	if (status === 429 || text.includes("rate limit") || text.includes("rate_limit")) return "Rate limited";
	if (status === 529 || text.includes("overloaded")) return "Model overloaded";
	if (status === 401 || status === 403 || text.includes("authentication")) return "Authentication failed";
	if (text.includes("cloud_credential")) return "Cloud credentials unavailable";
	if (text.includes("unable to connect") || text.includes("connection error")) return NO_RESPONSE;
	return "Request failed";
}

const ONCE_MORE_PREFIX = "Trying once more";

/**
 * The retry line's headline: upstream's short phrase, or "Trying once more,
 * for up to {minutes} min" for a single no-response retry whose wait is known.
 */
function retryHeadline(record: MarkerRecord): string
{
	const headline = errorHeadline(record.error);
	if (headline !== NO_RESPONSE || record.maxRetries !== 1 || record.retryInMs === undefined) return headline;
	return `${ONCE_MORE_PREFIX}, for up to ${Math.max(1, Math.ceil(record.retryInMs / 60_000))} min`;
}

/** "{headline} · Retrying (n/m)", except the once-more sentence stands alone. */
function retryLabel({
	error,
	attempt,
	maxRetries,
}: Readonly<
{
	error: string;
	attempt: number;
	maxRetries: number;
}>)
{
	return error.startsWith(ONCE_MORE_PREFIX) ? error : `${error} · Retrying (${attempt}/${maxRetries})`;
}

function userEvent(record: MarkerRecord, at: number): WorkingMarkerEvent | null
{
	if (record.isMeta === true || record.isCompactSummary === true) return null;
	const content = record.message?.content;
	if (content === undefined) return null;
	if (typeof content === "string")
	{
		return {
			kind: isRequestInterrupted(content) ? "stop" : "prompt",
			at,
		};
	}
	if (content.length === 0) return null;
	if (content.some((block) => block.type === "tool_result"))
		return {
			kind: "progress",
			at,
		};
	const text = content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
	return {
		kind: isRequestInterrupted(text) ? "stop" : "prompt",
		at,
	};
}

function assistantEvent(record: MarkerRecord, at: number): WorkingMarkerEvent
{
	const content = record.message?.content;
	const tools = Array.isArray(content) ? content.filter((block) => block.type === "tool_use") : [];
	const last = tools.at(-1);
	if (last === undefined)
	{
		const final = Array.isArray(content) ? content.at(-1) : undefined;
		return {
			kind: final?.type === "thinking" ? "thinking" : "progress",
			at,
		};
	}
	return {
		kind: "tool",
		at,
		label: toolActivityLabel(last.name ?? "", last.input),
	};
}

function systemEvent(record: MarkerRecord, at: number): WorkingMarkerEvent | null
{
	if (record.subtype === "turn_duration")
		return {
			kind: "stop",
			at,
		};
	if (record.subtype === "api_error" && record.retryAttempt !== undefined && record.maxRetries !== undefined)
	{
		return {
			kind: "retry",
			at,
			attempt: record.retryAttempt,
			maxRetries: record.maxRetries,
			error: retryHeadline(record),
		};
	}
	return null;
}

const ToolResultContentSchema = z.union([
	z.string(),
	z.array(
		z.object(
			{
				type: z.string(),
				text: z.string().optional(),
			},
		),
	),
]);

function toolResultLength(content: unknown): number
{
	const parsed = ToolResultContentSchema.safeParse(content);
	if (!parsed.success) return 0;
	if (typeof parsed.data === "string") return parsed.data.length;
	return parsed.data.reduce((sum, block) => sum + (block.text?.length ?? 0), 0);
}

function streamedLength(block: z.infer<typeof ContentBlockSchema>): number
{
	switch (block.type)
	{
		case "text":
			return block.text?.length ?? 0;
		case "thinking":
			return block.thinking?.length ?? 0;
		case "tool_use":
			return block.input === undefined ? 0 : JSON.stringify(block.input).length;
		case "tool_result":
			return toolResultLength(block.content);
		default:
			return 0;
	}
}

/** The turn's token estimate and when it first turned positive. */
export interface TurnTokenUsage
{
	tokens: number;
	/** When the turn's first character-adding record landed (ms), upstream's `firstPositiveAt`. */
	firstAt: number | undefined;
}

/**
 * Upstream's token counter, locally: the main thread's streamed characters
 * since the turn's prompt (assistant text, thinking and tool_use input JSON,
 * and tool_result content) divided by 4 and rounded, as upstream's `M6`.
 * Scans back only to that prompt.
 */
export function turnTokenUsage(records: readonly unknown[]): TurnTokenUsage
{
	let characters = 0;
	let firstAt: number | undefined;
	for (let i = records.length - 1; i >= 0; i--)
	{
		const parsed = MarkerRecordSchema.safeParse(records[i]);
		if (!parsed.success || parsed.data.isSidechain === true) continue;
		const record = parsed.data;
		if (record.type === "user" && userEvent(record, 0)?.kind === "prompt") break;
		if (record.type !== "user" && record.type !== "assistant") continue;
		const content = record.message?.content;
		if (!Array.isArray(content)) continue;
		let added = 0;
		for (const block of content) added += streamedLength(block);
		characters += added;
		if (added > 0 && record.timestamp !== undefined)
		{
			const at = Date.parse(record.timestamp);
			if (!Number.isNaN(at)) firstAt = at;
		}
	}
	return {
		tokens: Math.round(characters / 4),
		firstAt,
	};
}

export function turnTokenEstimate(records: readonly unknown[]): number
{
	return turnTokenUsage(records).tokens;
}

/** Whether a raw main-thread record is a real prompt (a turn's start) or a turn end (turn_duration or an interrupt). */
export function turnBoundaryKind(raw: unknown): "prompt" | "stop" | null
{
	const parsed = MarkerRecordSchema.safeParse(raw);
	if (!parsed.success || parsed.data.isSidechain === true) return null;
	const record = parsed.data;
	const event =
		record.type === "user" ? userEvent(record, 0) : record.type === "system" ? systemEvent(record, 0) : null;
	return event?.kind === "prompt" || event?.kind === "stop" ? event.kind : null;
}

/** The main thread's turn signals from raw JSONL records, oldest first. */
export function markerEventsFromRecords(records: readonly unknown[]): WorkingMarkerEvent[]
{
	const events: WorkingMarkerEvent[] = [];
	let lastAt = 0;
	for (const raw of records)
	{
		const parsed = MarkerRecordSchema.safeParse(raw);
		if (!parsed.success || parsed.data.isSidechain === true) continue;
		const record = parsed.data;
		const parsedAt = record.timestamp === undefined ? Number.NaN : Date.parse(record.timestamp);
		const at = Number.isNaN(parsedAt) ? lastAt : parsedAt;
		lastAt = at;
		let event: WorkingMarkerEvent | null = null;
		if (record.type === "user") event = userEvent(record, at);
		else if (record.type === "assistant") event = assistantEvent(record, at);
		else if (record.type === "system") event = systemEvent(record, at);
		if (event !== null) events.push(event);
	}
	return events;
}
