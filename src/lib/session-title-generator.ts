import {basename, join} from "node:path";
import {eq} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";
import {hmrPersist} from "./hmr-persist";
import {asRecord, isRecord} from "./narrow";
import {runClaude} from "./summaries";
import {readTailLines, type RunModel} from "./turn-verdict";

type SummariesDb = BetterSQLite3Database<typeof schema>;

/** Retitle once the conversation has grown by this many messages since the stored title. */
export const TITLE_REGENERATE_MESSAGES = 20;
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
}

/** Whether the session needs a (new) title: never judged, renamed since, or moved on by TITLE_REGENERATE_MESSAGES. */
export function titleNeedsGeneration(
	stored: StoredSessionTitle | undefined,
	current: {customTitle: string; messageCount: number},
): boolean {
	if (stored === undefined || stored.customTitle !== current.customTitle) return true;
	return stored.paneNamed && current.messageCount - stored.messageCount >= TITLE_REGENERATE_MESSAGES;
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

/** The main thread's typed prompts and assistant text in transcript `lines`, last characters kept, and the latest agent name. */
export function conversationFromLines(lines: Iterable<string>): {agentName: string | null; conversation: string} {
	let agentName: string | null = null;
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
		if (obj["isSidechain"] === true || obj["isMeta"] === true) continue;
		const content = asRecord(obj["message"])?.["content"];
		const role = obj["type"] === "user" || obj["type"] === "assistant" ? obj["type"] : null;
		const text = role === "user" ? promptText(content) : role === "assistant" ? textBlocks(content) : null;
		if (role !== null && text !== null) parts.push(`[${role}]\n${text}`);
	}
	return {agentName, conversation: parts.join("\n\n").slice(-MAX_CONVERSATION_CHARS)};
}

function titlePrompt(conversation: string): string {
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

/** The model's answer as a title, or null when it is empty or too long to be one. */
export function parseGeneratedTitle(output: string): string | null {
	const line = output
		.split("\n")
		.map((part) => part.trim())
		.find((part) => part !== "");
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

function readStored(summariesDb: SummariesDb, sessionId: string): StoredSessionTitle | undefined {
	const row = summariesDb
		.select()
		.from(schema.generatedTitles)
		.where(eq(schema.generatedTitles.sessionId, sessionId))
		.get();
	return row === undefined ? undefined : toStored(row);
}

function toStored(row: typeof schema.generatedTitles.$inferSelect): StoredSessionTitle {
	return {
		customTitle: row.customTitle,
		paneNamed: row.paneNamed === 1,
		agentName: row.agentName,
		cwdBasename: row.cwdBasename,
		title: row.title,
		messageCount: row.messageCount,
	};
}

/**
 * Judge whether the session's custom title is only its pane name and, when it is, title the session from its recent
 * conversation. A model answer that is not a title keeps the previous title. The result is stored either way, unless
 * `signal` aborted (the worker stopped, so shutdown may have closed the database); then it returns null.
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
	const previous = readStored(summariesDb, sessionId);
	let title = previous?.customTitle === customTitle ? previous.title : null;
	if (paneNamed && conversation !== "") {
		title = parseGeneratedTitle(await runModel(titlePrompt(conversation))) ?? title;
	} else if (!paneNamed) {
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
	queue: Map<string, SessionTitleQueueRequest>;
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
	if (stored === undefined || stored.customTitle !== customTitle || stored.title === null) return {};
	return {
		generatedTitle: stored.title,
		...(stored.agentName === null ? {} : {agentName: stored.agentName}),
		...(stored.cwdBasename === null ? {} : {cwdBasename: stored.cwdBasename}),
	};
}

/**
 * Queue a title for a bridged session with a custom title. A no-op until the worker starts (the server starts it;
 * tests and scripts never call the model), for a long-idle session, and while no title is due or one is queued.
 */
export function requestSessionTitle(request: SessionTitleQueueRequest, now: number): void {
	if (state.worker === null || now - request.mtimeMs > MAX_SESSION_AGE_MS) return;
	if (!titleNeedsGeneration(state.titles.get(request.sessionId), request)) return;
	if (state.queue.has(request.sessionId)) return;
	state.queue.set(request.sessionId, request);
	void drainQueue();
}

async function drainQueue(): Promise<void> {
	if (state.running) return;
	state.running = true;
	try {
		for (const [sessionId, {project, customTitle, cwd, messageCount}] of state.queue) {
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
				// A failed attempt still answers for this message count, so the row does not requeue it on every read.
				const previous = state.titles.get(sessionId);
				state.titles.set(sessionId, {
					customTitle,
					// Unjudged counts as pane-named so a failed first attempt retries once the conversation moves on.
					paneNamed: previous?.paneNamed ?? true,
					agentName: previous?.agentName ?? null,
					cwdBasename: previous?.cwdBasename ?? null,
					title: previous?.customTitle === customTitle ? previous.title : null,
					messageCount,
				});
				console.error(`Session title failed for ${sessionId}:`, err);
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
