import {basename, join} from "node:path";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";
import {hmrPersist} from "./hmr-persist";
import {asRecord, isRecord} from "./narrow";
import {errorLine, runClaude} from "./summaries";
import {readTailLines, type RunModel} from "./turn-verdict";

type SummariesDb = BetterSQLite3Database<typeof schema>;

/** Retitle once the conversation has grown by this many messages since the stored title. */
export const TITLE_REGENERATE_MESSAGES = 20;
/** After a failed attempt, wait this long before asking again, whatever the conversation does meanwhile. */
export const TITLE_RETRY_MS = 10 * 60 * 1000;
/** The title names the current work; keep the conversation's last characters. */
const MAX_CONVERSATION_CHARS = 6000;
const MAX_TITLE_CHARS = 80;
/** Sessions untouched for longer than this get no title, so a restart does not queue every old bridged session. */
const MAX_SESSION_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** A custom title that only repeats the session's pane name (`--name`, the agent name) or its cwd basename. */
export function isPaneNameTitle(
	customTitle: string | undefined,
	names: {agentName?: string | undefined; cwdBasename?: string | undefined},
): boolean {
	return customTitle !== undefined && (customTitle === names.agentName || customTitle === names.cwdBasename);
}

export interface StoredSessionTitle {
	/** The custom title this row judged. */
	customTitle: string;
	paneNamed: boolean;
	agentName: string | null;
	cwdBasename: string | null;
	/** The generated title, null until one is generated or when the custom title is deliberate. */
	title: string | null;
	/** The session's message count when the row was written. */
	messageCount: number;
	/** In memory only: the last attempt failed, so do not retry before this time. */
	retryAt?: number;
	/** In memory only: the transcript had no conversation to title at this message count, so wait for it to change. */
	noConversationAt?: number;
}

/** The transcript has nothing to title yet; not a model failure, so it is neither logged nor retried on a timer. */
class NoConversationError extends Error {
	constructor() {
		super("No conversation to title");
	}
}

/**
 * Whether the session needs a (new) title: never judged, renamed since, pane-named but still untitled, or moved on by
 * TITLE_REGENERATE_MESSAGES. After a failed attempt it waits for `retryAt` instead, and after finding no conversation
 * it waits for the message count to change.
 */
export function titleNeedsGeneration(
	stored: StoredSessionTitle | undefined,
	current: {customTitle: string; messageCount: number},
	now: number,
): boolean {
	if (stored === undefined || stored.customTitle !== current.customTitle) return true;
	if (!stored.paneNamed) return false;
	if (stored.noConversationAt !== undefined) return current.messageCount !== stored.noConversationAt;
	if (stored.retryAt !== undefined) return now >= stored.retryAt;
	return stored.title === null || current.messageCount - stored.messageCount >= TITLE_REGENERATE_MESSAGES;
}

function promptText(content: unknown): string | null {
	if (typeof content === "string") return content.startsWith("<") ? null : content;
	return textBlocks(content);
}

function textBlocks(content: unknown): string | null {
	if (!Array.isArray(content)) return null;
	const texts = content.flatMap((block) =>
		isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : [],
	);
	return texts.length > 0 ? texts.join("\n") : null;
}

/**
 * The main thread's typed prompts and assistant text in transcript `lines`, last characters kept, and the latest agent
 * name. A tail of only tool calls and results (large tool output fills the read window) falls back to the CLI's
 * `last-prompt` record.
 */
export function conversationFromLines(lines: Iterable<string>): {agentName: string | null; conversation: string} {
	let agentName: string | null = null;
	let lastPrompt: string | null = null;
	const parts: string[] = [];
	for (const line of lines) {
		let obj: unknown;
		try {
			obj = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(obj)) continue;
		if (obj["type"] === "agent-name" && typeof obj["agentName"] === "string") {
			agentName = obj["agentName"];
			continue;
		}
		if (obj["type"] === "last-prompt" && typeof obj["lastPrompt"] === "string") {
			lastPrompt = obj["lastPrompt"];
			continue;
		}
		if (obj["isSidechain"] === true || obj["isMeta"] === true) continue;
		const content = asRecord(obj["message"])?.["content"];
		const role = obj["type"] === "user" || obj["type"] === "assistant" ? obj["type"] : null;
		const text = role === "user" ? promptText(content) : role === "assistant" ? textBlocks(content) : null;
		if (role !== null && text !== null) parts.push(`[${role}]\n${text}`);
	}
	if (parts.length === 0 && lastPrompt !== null && lastPrompt.trim() !== "") parts.push(`[user]\n${lastPrompt}`);
	return {agentName, conversation: parts.join("\n\n").slice(-MAX_CONVERSATION_CHARS)};
}

export function titlePrompt(conversation: string): string {
	return [
		"Below is the recent part of a conversation between a user and a coding assistant.",
		"Write a title for the conversation as it stands now, naming the current work.",
		"Use sentence case and 3-6 words, with no quotes and no trailing punctuation. Answer with only the title.",
		"",
		"<conversation>",
		conversation,
		"</conversation>",
	].join("\n");
}

/** The model's answer as a title, skipping lead-in lines that end with a colon, or null when it is empty or too long to be one. */
export function parseGeneratedTitle(output: string): string | null {
	const line = output
		.split("\n")
		.map((part) => part.trim())
		.find((part) => part !== "" && !part.endsWith(":"));
	if (line === undefined) return null;
	const title = line
		.replace(/^title:\s*/i, "")
		.replace(/^["'`]+|["'`]+$/g, "")
		.replace(/\.$/, "")
		.trim();
	return title === "" || title.length > MAX_TITLE_CHARS ? null : title;
}

export interface SessionTitleRequest {
	sessionId: string;
	filePath: string;
	customTitle: string;
	cwd: string | undefined;
	messageCount: number;
}

function toStored(row: typeof schema.generatedTitles.$inferSelect): StoredSessionTitle {
	return {
		customTitle: row.customTitle,
		paneNamed: row.paneNamed === 1,
		agentName: row.agentName,
		cwdBasename: row.cwdBasename,
		// Rows written before empty answers counted as failures may hold "".
		title: row.title?.trim() ? row.title : null,
		messageCount: row.messageCount,
	};
}

/**
 * Judge whether the session's custom title is only its pane name and, when it is, title the session from its recent
 * conversation, storing the result. A pane-named session with no conversation to title or a model answer that is not
 * a title throws and stores nothing, so the previous row stands. When `signal` aborted (the worker stopped, so
 * shutdown may have closed the database) it stores nothing and returns null.
 */
export async function generateSessionTitle(
	summariesDb: SummariesDb,
	{sessionId, filePath, customTitle, cwd, messageCount}: SessionTitleRequest,
	runModel: RunModel = runClaude,
	signal?: AbortSignal,
): Promise<StoredSessionTitle | null> {
	const {agentName, conversation} = conversationFromLines(await readTailLines(filePath));
	const cwdBasename = cwd === undefined ? null : basename(cwd);
	const paneNamed = isPaneNameTitle(customTitle, {
		agentName: agentName ?? undefined,
		cwdBasename: cwdBasename ?? undefined,
	});
	let title: string | null;
	if (paneNamed) {
		if (conversation === "") throw new NoConversationError();
		const output = await runModel(titlePrompt(conversation));
		title = parseGeneratedTitle(output);
		if (title === null) throw new Error(`The model gave no usable title: ${JSON.stringify(output.slice(0, 200))}`);
	} else {
		title = null;
	}
	if (signal?.aborted === true) return null;
	const stored: StoredSessionTitle = {customTitle, paneNamed, agentName, cwdBasename, title, messageCount};
	const row = {...stored, paneNamed: paneNamed ? 1 : 0, generatedAt: Date.now()};
	summariesDb
		.insert(schema.generatedTitles)
		.values({sessionId, ...row})
		.onConflictDoUpdate({target: schema.generatedTitles.sessionId, set: row})
		.run();
	return stored;
}

interface SessionTitleWorker {
	summariesDb: SummariesDb;
	projectsDir: string;
	runModel: RunModel;
	onTitle: (sessionId: string) => void;
	/** Aborts when the worker stops, so in-flight work neither touches the database nor logs. */
	stopped: AbortSignal;
}

export interface SessionTitleQueueRequest {
	sessionId: string;
	project: string;
	customTitle: string;
	cwd: string | undefined;
	messageCount: number;
	/** The transcript's mtime, so long-idle sessions are never queued. */
	mtimeMs: number;
}

interface SessionTitleState {
	titles: Map<string, StoredSessionTitle>;
	/** Each queued request with the time it was requested, which a failure's backoff counts from. */
	queue: Map<string, SessionTitleQueueRequest & {requestedAt: number}>;
	worker: SessionTitleWorker | null;
	running: boolean;
}

const state = hmrPersist<SessionTitleState>("sessionTitleState", () => ({
	titles: new Map(),
	queue: new Map(),
	worker: null,
	running: false,
}));

/**
 * The generated title and the pane names it was judged against, for resolveSessionTitle; empty unless the session
 * has a generated title for this custom title.
 */
export function generatedTitleSources(
	sessionId: string,
	customTitle: string | undefined,
): {generatedTitle?: string; agentName?: string; cwdBasename?: string} {
	const stored = state.titles.get(sessionId);
	if (stored === undefined || stored.customTitle !== customTitle || !stored.title?.trim()) return {};
	return {
		generatedTitle: stored.title,
		...(stored.agentName === null ? {} : {agentName: stored.agentName}),
		...(stored.cwdBasename === null ? {} : {cwdBasename: stored.cwdBasename}),
	};
}

/**
 * The title every view names an indexed session by: for a bridged session whose custom title is only its pane name,
 * the title generated from its conversation, else the indexed `title` (which never holds the generated title).
 */
export function displayedSessionTitle(session: {
	id: string;
	title: string;
	customTitle?: string | null | undefined;
	bridged: boolean;
}): string {
	if (!session.bridged || session.customTitle == null) return session.title;
	const sources = generatedTitleSources(session.id, session.customTitle);
	return sources.generatedTitle !== undefined && isPaneNameTitle(session.customTitle, sources)
		? sources.generatedTitle
		: session.title;
}

/**
 * Queue a title for a bridged session with a custom title. A no-op until the worker starts (the server starts it;
 * tests and scripts never call the model), for a long-idle session, and while no title is due or one is queued.
 */
export function requestSessionTitle(request: SessionTitleQueueRequest, now: number): void {
	if (state.worker === null || now - request.mtimeMs > MAX_SESSION_AGE_MS) return;
	if (!titleNeedsGeneration(state.titles.get(request.sessionId), request, now)) return;
	if (state.queue.has(request.sessionId)) return;
	state.queue.set(request.sessionId, {...request, requestedAt: now});
	void drainQueue();
}

async function drainQueue(): Promise<void> {
	if (state.running) return;
	state.running = true;
	try {
		for (const [sessionId, {project, customTitle, cwd, messageCount, requestedAt}] of state.queue) {
			state.queue.delete(sessionId);
			const worker = state.worker;
			if (worker === null) return;
			const before = state.titles.get(sessionId)?.title ?? null;
			try {
				const stored = await generateSessionTitle(
					worker.summariesDb,
					{
						sessionId,
						filePath: join(worker.projectsDir, project, `${sessionId}.jsonl`),
						customTitle,
						cwd,
						messageCount,
					},
					worker.runModel,
					worker.stopped,
				);
				if (stored === null || worker.stopped.aborted) continue;
				state.titles.set(sessionId, stored);
				if (stored.title !== before) worker.onTitle(sessionId);
			} catch (err) {
				if (worker.stopped.aborted) continue;
				// A failed attempt keeps the previous title and backs off, so reads do not requeue it every time.
				const previous = state.titles.get(sessionId);
				const same = previous?.customTitle === customTitle;
				const noConversation = err instanceof NoConversationError;
				state.titles.set(sessionId, {
					customTitle,
					// Unjudged counts as pane-named so a failed first attempt retries.
					paneNamed: same ? previous.paneNamed : true,
					agentName: previous?.agentName ?? null,
					cwdBasename: previous?.cwdBasename ?? null,
					title: same ? previous.title : null,
					messageCount: same ? previous.messageCount : messageCount,
					...(noConversation ? {noConversationAt: messageCount} : {retryAt: requestedAt + TITLE_RETRY_MS}),
				});
				if (!noConversation) console.error(`Session title failed for ${sessionId}: ${errorLine(err)}`);
			}
		}
	} finally {
		state.running = false;
	}
}

/** Load the stored titles and start titling requested sessions; `onTitle` rebroadcasts a session whose title changed. */
export function startSessionTitleWorker({
	summariesDb,
	projectsDir,
	runModel = runClaude,
	onTitle,
}: Omit<SessionTitleWorker, "runModel" | "stopped"> & {runModel?: RunModel}): () => void {
	for (const row of summariesDb.select().from(schema.generatedTitles).all()) {
		state.titles.set(row.sessionId, toStored(row));
	}
	const controller = new AbortController();
	state.worker = {summariesDb, projectsDir, runModel, onTitle, stopped: controller.signal};
	return () => {
		controller.abort();
		state.worker = null;
		state.queue.clear();
		state.titles.clear();
	};
}
