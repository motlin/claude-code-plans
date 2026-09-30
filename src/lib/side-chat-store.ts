import {useSyncExternalStore} from "react";
import {z} from "zod";

import {buildSideChatPrompt, sideChatBranchTitle, type SideChatMessage} from "./side-chat";

export type SideChatEntryStatus = "pending" | "done" | "error";

export interface SideChatEntry {
	id: number;
	question: string;
	answer: string;
	status: SideChatEntryStatus;
	error?: string;
	/** Live tool label while pending, e.g. "Reading config.ts". */
	activity?: string;
	stopping?: boolean;
	/** Set while "Branch to new chat" forks the session. */
	branching?: boolean;
}

/**
 * Where an open side chat shows, like upstream: the floating card, a docked
 * `side-chat` tile in the pane host, or its own browser window.
 */
export type SideChatMode = "floating" | "docked" | "popout";

export interface SideChatSession {
	open: boolean;
	mode: SideChatMode;
	entries: readonly SideChatEntry[];
}

const NO_ANSWER_MESSAGE = "No answer yet. Send a message in the main chat first, then ask again.";

const EMPTY_SESSION: SideChatSession = {open: false, mode: "floating", entries: []};

/**
 * Per-session side chat threads, in memory only like upstream's
 * `sideChatStore.openBySession`: a reload starts every side chat afresh.
 */
let sessions = new Map<string, SideChatSession>();
const listeners = new Set<() => void>();
const inFlight = new Map<number, {abort: AbortController; processId: string | null}>();
let nextEntryId = 1;

function emit(): void {
	for (const listener of listeners) listener();
}

function update(sessionId: string, change: (session: SideChatSession) => SideChatSession): void {
	sessions = new Map(sessions).set(sessionId, change(getSideChat(sessionId)));
	emit();
}

function updateEntry(sessionId: string, entryId: number, change: (entry: SideChatEntry) => SideChatEntry): void {
	update(sessionId, (session) => ({
		...session,
		entries: session.entries.map((entry) => (entry.id === entryId ? change(entry) : entry)),
	}));
}

export function getSideChat(sessionId: string): SideChatSession {
	return sessions.get(sessionId) ?? EMPTY_SESSION;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function useSideChat(sessionId: string): SideChatSession {
	return useSyncExternalStore(
		subscribe,
		() => getSideChat(sessionId),
		() => EMPTY_SESSION,
	);
}

export function openSideChat(sessionId: string): void {
	update(sessionId, (session) => ({...session, open: true}));
}

export function closeSideChat(sessionId: string): void {
	update(sessionId, (session) => ({...session, open: false}));
}

export function toggleSideChat(sessionId: string): void {
	update(sessionId, (session) => ({...session, open: !session.open}));
}

/** Moves the side chat between its floating, docked and pop-out variants, keeping its thread. */
export function setSideChatMode(sessionId: string, mode: SideChatMode): void {
	update(sessionId, (session) => (session.mode === mode ? session : {...session, mode}));
}

export function clearSideChat(sessionId: string): void {
	for (const entry of getSideChat(sessionId).entries) void stopEntry(sessionId, entry.id);
	update(sessionId, (session) => ({...session, entries: []}));
}

/** The answered Q/A pairs before `entryId` (or all of them), for the stateless prompt. */
function priorSideChatMessages(sessionId: string, entryId?: number): SideChatMessage[] {
	const messages: SideChatMessage[] = [];
	for (const entry of getSideChat(sessionId).entries) {
		if (entry.id === entryId) break;
		if (entry.status === "done") messages.push({q: entry.question, a: entry.answer});
	}
	return messages;
}

/** Test hook: forget every side chat. */
export function resetSideChatStore(): void {
	for (const {abort} of inFlight.values()) abort.abort();
	inFlight.clear();
	sessions = new Map();
	emit();
}

export async function askSideChat(sessionId: string, question: string): Promise<void> {
	const trimmed = question.trim();
	if (trimmed === "") return;
	const messages = priorSideChatMessages(sessionId);
	const entryId = nextEntryId++;
	update(sessionId, (session) => ({
		...session,
		entries: [...session.entries, {id: entryId, question: trimmed, answer: "", status: "pending"}],
	}));

	const abort = new AbortController();
	const flight = {abort, processId: null as string | null};
	inFlight.set(entryId, flight);
	try {
		const response = await fetch("/api/side-chat", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({sessionId, messages, question: trimmed}),
			signal: abort.signal,
		});
		if (!response.ok) {
			fail(sessionId, entryId, await readResponseError(response));
			return;
		}
		flight.processId = response.headers.get("X-Process-Id");
		let answer = "";
		let error: string | undefined;
		await readStreamEvents(response, (event) => {
			const delta = textDelta(event);
			if (delta !== null) {
				answer += delta;
				updateEntry(sessionId, entryId, (entry) => withoutActivity({...entry, answer}));
				return;
			}
			const activity = toolActivity(event);
			if (activity !== null) {
				updateEntry(sessionId, entryId, (entry) => ({...entry, activity}));
				return;
			}
			const failure = streamError(event);
			if (failure !== null) error = failure;
			else if (answer === "" && event.type === "result" && typeof event.result === "string") {
				answer = event.result;
			}
		});
		if (error !== undefined) fail(sessionId, entryId, error);
		else if (answer.trim() === "") fail(sessionId, entryId, NO_ANSWER_MESSAGE);
		else updateEntry(sessionId, entryId, (entry) => finish({...entry, answer}, "done"));
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			updateEntry(sessionId, entryId, (entry) =>
				entry.answer === "" ? finish(entry, "error", "Stopped.") : finish(entry, "done"),
			);
		} else {
			fail(sessionId, entryId, err instanceof Error ? err.message : String(err));
		}
	} finally {
		inFlight.delete(entryId);
	}
}

/** Stop a pending answer: abort the request and kill its CLI process. */
export async function stopEntry(sessionId: string, entryId: number): Promise<void> {
	const flight = inFlight.get(entryId);
	if (flight === undefined) return;
	updateEntry(sessionId, entryId, (entry) => ({...entry, stopping: true}));
	flight.abort.abort();
	if (flight.processId === null) return;
	try {
		await fetch("/api/side-chat", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({action: "cancel", processId: flight.processId}),
		});
	} catch {
		// Best effort: the process exits on its own once the answer is done.
	}
}

/**
 * "Branch to new chat": replay the side question as a real forked session via
 * `/api/chat` (the same `--fork-session` call without
 * `--no-session-persistence`), title the fork `btw: <question>` and resolve
 * with its id. Resolves null when the fork never reported a session id.
 */
export async function branchSideChatEntry(sessionId: string, entryId: number): Promise<string | null> {
	const entry = getSideChat(sessionId).entries.find((e) => e.id === entryId);
	if (entry === undefined) return null;
	updateEntry(sessionId, entryId, (e) => ({...e, branching: true}));
	try {
		const prompt = buildSideChatPrompt(priorSideChatMessages(sessionId, entryId), entry.question);
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({sessionId, prompt}),
		});
		if (!response.ok) throw new Error(await readResponseError(response));
		let forkedId: string | null = null;
		let error: string | null = null;
		await readStreamEvents(response, (event) => {
			if (typeof event.session_id === "string" && event.session_id !== "") {
				forkedId = event.session_id;
			}
			error = streamError(event) ?? error;
		});
		if (error !== null) throw new Error(error);
		if (forkedId === null) return null;
		await fetch(`/api/sessions/${encodeURIComponent(forkedId)}/title`, {
			method: "PUT",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({title: sideChatBranchTitle(entry.question)}),
		}).catch(() => undefined);
		return forkedId;
	} finally {
		updateEntry(sessionId, entryId, ({branching: _branching, ...rest}) => rest);
	}
}

function withoutActivity(entry: SideChatEntry): SideChatEntry {
	const {activity: _activity, ...rest} = entry;
	return rest;
}

function finish(entry: SideChatEntry, status: SideChatEntryStatus, error?: string): SideChatEntry {
	const {activity: _activity, stopping: _stopping, error: _error, ...rest} = entry;
	return error === undefined ? {...rest, status} : {...rest, status, error};
}

function fail(sessionId: string, entryId: number, error: string): void {
	updateEntry(sessionId, entryId, (entry) => finish(entry, "error", error));
}

interface StreamEvent {
	type?: unknown;
	subtype?: unknown;
	session_id?: unknown;
	result?: unknown;
	is_error?: unknown;
	message?: unknown;
	event?: unknown;
}

async function readResponseError(response: Response): Promise<string> {
	const fallback = `Request failed (${response.status})`;
	const body: unknown = await response.json().catch(() => null);
	if (typeof body === "object" && body !== null && "error" in body) {
		return typeof body.error === "string" ? body.error : fallback;
	}
	return fallback;
}

/** Feed each parsed NDJSON line of a streaming response to `onEvent`. */
async function readStreamEvents(response: Response, onEvent: (event: StreamEvent) => void): Promise<void> {
	if (response.body === null) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const flush = (line: string) => {
		const trimmed = line.trim();
		if (trimmed === "") return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			return;
		}
		if (typeof parsed === "object" && parsed !== null) onEvent(parsed as StreamEvent);
	};
	while (true) {
		const {done, value} = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, {stream: true});
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) flush(line);
	}
	flush(buffer + decoder.decode());
}

const TextDeltaEventSchema = z.object({
	type: z.literal("stream_event"),
	event: z.object({
		type: z.literal("content_block_delta"),
		delta: z.object({type: z.literal("text_delta"), text: z.string()}),
	}),
});

const ToolUseBlockSchema = z.object({
	type: z.literal("tool_use"),
	name: z.string(),
	input: z.object({file_path: z.string().optional(), pattern: z.string().optional()}),
});

const AssistantEventSchema = z.object({
	type: z.literal("assistant"),
	message: z.object({content: z.array(z.unknown())}),
});

function textDelta(event: StreamEvent): string | null {
	const parsed = TextDeltaEventSchema.safeParse(event);
	return parsed.success ? parsed.data.event.delta.text : null;
}

function basename(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

/** Upstream's pending labels for the tools a side question typically runs. */
function toolActivityLabel({name, input}: z.infer<typeof ToolUseBlockSchema>): string | null {
	if (name === "Read" && input.file_path !== undefined) {
		return `Reading ${basename(input.file_path)}`;
	}
	if (name === "Grep" && input.pattern !== undefined) return `Searching for ${input.pattern}`;
	if (name === "Glob") return "Finding files";
	return null;
}

function toolActivity(event: StreamEvent): string | null {
	const parsed = AssistantEventSchema.safeParse(event);
	if (!parsed.success) return null;
	let label: string | null = null;
	for (const block of parsed.data.message.content) {
		const toolUse = ToolUseBlockSchema.safeParse(block);
		if (toolUse.success) label = toolActivityLabel(toolUse.data) ?? label;
	}
	return label;
}

function streamError(event: StreamEvent): string | null {
	if (event.type === "result" && event.is_error === true) {
		return typeof event.result === "string" ? event.result : "Unknown error";
	}
	if (event.type === "error") {
		return typeof event.message === "string" ? event.message : "Unknown error";
	}
	return null;
}
