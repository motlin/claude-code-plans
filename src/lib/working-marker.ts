import {z} from "zod";
import {isRequestInterrupted} from "./session-utils";
import {assertNever} from "./assert-never";

/**
 * One signal in a session's current turn, normalized from transcript records
 * and live hook state. `progress` is any response that is not a tool call:
 * it ends a tool's activity label, any pending API retry and any thinking.
 * `thinking` is an assistant record whose last block is a thinking block.
 */
export type WorkingMarkerEvent =
	| {kind: "prompt"; at: number}
	| {kind: "tool"; at: number; label: string}
	| {kind: "progress"; at: number}
	| {kind: "thinking"; at: number}
	| {kind: "retry"; at: number; attempt: number; maxRetries: number; error: string}
	| {kind: "interrupt"; at: number}
	| {kind: "stop"; at: number};

/** Upstream claude.ai/code's transcript tail marker (busy / stopping / retrying / hidden). */
export type WorkingMarkerState =
	| {status: "idle"}
	| {status: "stopping"}
	/** Blocked on a tool permission prompt: a still spark with no status text. */
	| {status: "waiting"}
	| {status: "working"; label: string; thinking: boolean; turnStartedAt: number; elapsedSeconds: number}
	| {
			status: "retrying";
			error: string;
			attempt: number;
			maxRetries: number;
			turnStartedAt: number;
			elapsedSeconds: number;
	  };

const WORKING_LABEL = "Working…";

interface Turn {
	startedAt: number;
	label: string;
	retry: {attempt: number; maxRetries: number; error: string} | null;
	stopping: boolean;
	thinking: boolean;
}

export function workingMarkerState(events: readonly WorkingMarkerEvent[], now: number): WorkingMarkerState {
	let turn: Turn | null = null;
	for (const event of events) {
		if (event.kind === "prompt") {
			turn = {startedAt: event.at, label: WORKING_LABEL, retry: null, stopping: false, thinking: false};
			continue;
		}
		if (turn === null) continue;
		switch (event.kind) {
			case "tool":
				turn = {...turn, label: event.label, retry: null, thinking: false};
				break;
			case "progress":
				turn = {...turn, label: WORKING_LABEL, retry: null, thinking: false};
				break;
			case "thinking":
				turn = {...turn, label: WORKING_LABEL, retry: null, thinking: true};
				break;
			case "retry":
				turn = {
					...turn,
					retry: {attempt: event.attempt, maxRetries: event.maxRetries, error: event.error},
				};
				break;
			case "interrupt":
				turn = {...turn, stopping: true};
				break;
			case "stop":
				turn = null;
				break;
		}
	}

	if (turn === null) return {status: "idle"};
	if (turn.stopping) return {status: "stopping"};
	const elapsedSeconds = Math.max(0, Math.floor((now - turn.startedAt) / 1000));
	if (turn.retry !== null) {
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
		turnStartedAt: turn.startedAt,
		elapsedSeconds,
	};
}

const ELAPSED_UNITS = [
	{unit: "day", seconds: 86_400},
	{unit: "hour", seconds: 3600},
	{unit: "minute", seconds: 60},
	{unit: "second", seconds: 1},
] as const;

type ElapsedUnit = (typeof ELAPSED_UNITS)[number]["unit"];

function formatUnit(value: number, unit: ElapsedUnit): string {
	try {
		return new Intl.NumberFormat("en", {style: "unit", unit, unitDisplay: "narrow"}).format(value);
	} catch {
		return `${value}${unit[0]}`;
	}
}

/**
 * Upstream's elapsed format (`nW`): up to three consecutive units starting at
 * the largest non-zero one, zero units dropped, no padding ("1m 5s", "1h 2m 5s").
 */
export function formatElapsed(totalSeconds: number): string {
	const start = ELAPSED_UNITS.findIndex(({seconds}) => totalSeconds >= seconds);
	if (start === -1) return formatUnit(0, "second");
	let remaining = totalSeconds;
	const parts: string[] = [];
	for (const {unit, seconds} of ELAPSED_UNITS.slice(start, start + 3)) {
		const value = Math.floor(remaining / seconds);
		remaining -= value * seconds;
		if (value > 0) parts.push(formatUnit(value, unit));
	}
	return parts.join(" ");
}

const THINKING_STAT = "Thinking";

/** Upstream shows a live elapsed clock only from 2s (`R=u>=2?u:void 0`). */
export const ELAPSED_MIN_SECONDS = 2;

function liveElapsedStats(elapsedSeconds: number): string[] {
	return elapsedSeconds < ELAPSED_MIN_SECONDS ? [] : [formatElapsed(elapsedSeconds)];
}

/**
 * Whether the working line goes quiet because the transcript draws the
 * in-flight call as its own busy row: upstream keeps the line mounted but
 * invisible, so there is no second status line. Stopping and retrying still show.
 */
export function tailMarkerQuiet(state: WorkingMarkerState, inFlightRow: boolean): boolean {
	return inFlightRow && state.status === "working";
}

/** The working line's visible pieces: an optional label, then "·"-joined stats. */
export interface WorkingLineParts {
	label: string;
	stats: string[];
}

export function workingLineParts(state: WorkingMarkerState): WorkingLineParts {
	switch (state.status) {
		case "idle":
		case "waiting":
			return {label: "", stats: []};
		case "stopping":
			// Upstream's e2() strips the trailing ellipsis: "Stopping", with no clock.
			return {label: "Stopping", stats: []};
		case "working":
			// Upstream appends a plain "Thinking" stat while a thinking block streams.
			return {
				label: "",
				stats: [...liveElapsedStats(state.elapsedSeconds), ...(state.thinking ? [THINKING_STAT] : [])],
			};
		case "retrying":
			return {
				label: `${state.error} · Retrying (${state.attempt}/${state.maxRetries})`,
				stats: liveElapsedStats(state.elapsedSeconds),
			};
		default:
			return assertNever(state);
	}
}

export function workingMarkerText(state: WorkingMarkerState): string {
	const {label, stats} = workingLineParts(state);
	return [label, ...stats].filter((part) => part !== "").join(" · ");
}

/** The polite sr-only status: upstream announces "Working…", never the ticking clock. */
export function workingLineAnnouncement(state: WorkingMarkerState): string {
	switch (state.status) {
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

function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

function hostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

const ToolInputFieldsSchema = z.object({
	file_path: z.string().optional(),
	pattern: z.string().optional(),
	description: z.string().optional(),
	url: z.string().optional(),
});

/** The status-line label for a running tool; `input` is unknown for hook-only pending tools. */
export function toolActivityLabel(name: string, input: unknown): string {
	const parsed = ToolInputFieldsSchema.safeParse(input);
	const fields = parsed.success ? parsed.data : {};
	const file = fields.file_path === undefined ? "file" : basename(fields.file_path);
	switch (name) {
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

const ContentBlockSchema = z.object({
	type: z.string(),
	text: z.string().optional(),
	name: z.string().optional(),
	input: z.unknown().optional(),
});

const MarkerRecordSchema = z.object({
	type: z.string(),
	subtype: z.string().optional(),
	timestamp: z.string().optional(),
	isMeta: z.boolean().optional(),
	isSidechain: z.boolean().optional(),
	isCompactSummary: z.boolean().optional(),
	retryAttempt: z.number().optional(),
	maxRetries: z.number().optional(),
	error: z.unknown().optional(),
	message: z.object({content: z.union([z.string(), z.array(ContentBlockSchema)]).optional()}).optional(),
});

type MarkerRecord = z.infer<typeof MarkerRecordSchema>;

const ErrorObjectSchema = z.object({
	formatted: z.string().optional(),
	message: z.string().optional(),
});

function errorHeadline(error: unknown): string {
	if (typeof error === "string") return error;
	const parsed = ErrorObjectSchema.safeParse(error);
	return (parsed.success ? (parsed.data.formatted ?? parsed.data.message) : undefined) ?? "API error";
}

function userEvent(record: MarkerRecord, at: number): WorkingMarkerEvent | null {
	if (record.isMeta === true || record.isCompactSummary === true) return null;
	const content = record.message?.content;
	if (content === undefined) return null;
	if (typeof content === "string") {
		return {kind: isRequestInterrupted(content) ? "stop" : "prompt", at};
	}
	if (content.length === 0) return null;
	if (content.some((block) => block.type === "tool_result")) return {kind: "progress", at};
	const text = content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
	return {kind: isRequestInterrupted(text) ? "stop" : "prompt", at};
}

function assistantEvent(record: MarkerRecord, at: number): WorkingMarkerEvent {
	const content = record.message?.content;
	const tools = Array.isArray(content) ? content.filter((block) => block.type === "tool_use") : [];
	const last = tools.at(-1);
	if (last === undefined) {
		const final = Array.isArray(content) ? content.at(-1) : undefined;
		return {kind: final?.type === "thinking" ? "thinking" : "progress", at};
	}
	return {kind: "tool", at, label: toolActivityLabel(last.name ?? "", last.input)};
}

function systemEvent(record: MarkerRecord, at: number): WorkingMarkerEvent | null {
	if (record.subtype === "turn_duration") return {kind: "stop", at};
	if (record.subtype === "api_error" && record.retryAttempt !== undefined && record.maxRetries !== undefined) {
		return {
			kind: "retry",
			at,
			attempt: record.retryAttempt,
			maxRetries: record.maxRetries,
			error: errorHeadline(record.error),
		};
	}
	return null;
}

/** The main thread's turn signals from raw JSONL records, oldest first. */
export function markerEventsFromRecords(records: readonly unknown[]): WorkingMarkerEvent[] {
	const events: WorkingMarkerEvent[] = [];
	let lastAt = 0;
	for (const raw of records) {
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
