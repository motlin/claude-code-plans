import {open} from "node:fs/promises";
import {join} from "node:path";
import {eq} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema";
import {hmrPersist} from "./hmr-persist";
import {asRecord, isRecord} from "./narrow";
import {runClaude} from "./summaries";

type SummariesDb = BetterSQLite3Database<typeof schema>;

/** The final turn sits at the end of the transcript; a large session's head is never read. */
const TAIL_BYTES = 1024 * 1024;
/** The end of the turn holds the ask; keep its last characters. */
const MAX_TURN_CHARS = 8000;
/** Turns that ended longer ago than this get no verdict, so a restart does not queue every old unread session. */
const MAX_TURN_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type RunModel = (prompt: string) => Promise<string>;

export interface FinalTurn {
	/** The uuid of the turn's last main-thread assistant record with text. */
	uuid: string;
	/** The turn's assistant text, oldest first, capped to its last MAX_TURN_CHARS characters. */
	text: string;
}

function assistantText(content: unknown): string | null {
	if (!Array.isArray(content)) return null;
	const texts = content.flatMap((block) =>
		isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : [],
	);
	return texts.length > 0 ? texts.join("\n") : null;
}

/** A user record the user typed, as opposed to a tool result the harness fed back. */
function isPrompt(content: unknown): boolean {
	if (typeof content === "string") return true;
	return Array.isArray(content) && content.some((block) => isRecord(block) && block["type"] === "text");
}

/** The final main-thread assistant turn in transcript `lines`: the assistant text since the last typed prompt. */
export function finalTurnFromLines(lines: Iterable<string>): FinalTurn | null {
	let texts: string[] = [];
	let uuid: string | null = null;
	for (const line of lines) {
		let obj: unknown;
		try {
			obj = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(obj) || obj["isSidechain"] === true || obj["isMeta"] === true) continue;
		const content = asRecord(obj["message"])?.["content"];
		if (obj["type"] === "user" && isPrompt(content)) {
			texts = [];
			uuid = null;
		} else if (obj["type"] === "assistant" && obj["isApiErrorMessage"] !== true) {
			const text = assistantText(content);
			if (text !== null && typeof obj["uuid"] === "string") {
				texts.push(text);
				uuid = obj["uuid"];
			}
		}
	}
	if (uuid === null) return null;
	return {uuid, text: texts.join("\n\n").slice(-MAX_TURN_CHARS)};
}

async function readTailLines(filePath: string): Promise<string[]> {
	const handle = await open(filePath, "r");
	try {
		const {size} = await handle.stat();
		const start = Math.max(0, size - TAIL_BYTES);
		const buffer = Buffer.alloc(size - start);
		await handle.read(buffer, 0, buffer.length, start);
		const lines = buffer.toString("utf8").split("\n");
		// A tail that starts mid-file starts mid-line.
		return start > 0 ? lines.slice(1) : lines;
	} finally {
		await handle.close();
	}
}

function turnVerdictPrompt(turnText: string): string {
	return [
		"Below is the final message a coding assistant sent to its user at the end of a turn.",
		"Does it ask the user to decide or act before work can continue? Questions, offers that wait on a choice",
		'("Your call", "Want me to…?", "tell me and I\'ll…"), and requests to do something ("Push it", "run …") are yes.',
		'A report of finished work that needs nothing more ("No response requested", "Done") is no.',
		"Answer with exactly one word: NEEDS_INPUT or NO_INPUT.",
		"",
		"<message>",
		turnText,
		"</message>",
	].join("\n");
}

/** The model's answer as a verdict, or null when it gave neither word. */
export function parseTurnVerdict(output: string): boolean | null {
	if (output.includes("NEEDS_INPUT")) return true;
	if (output.includes("NO_INPUT")) return false;
	return null;
}

export interface TurnVerdictRequest {
	sessionId: string;
	filePath: string;
	/** The session's indexed turn end the verdict answers for. */
	turnEndedAt: number;
}

export interface TurnVerdict {
	turnEndedAt: number;
	needsInput: boolean;
}

/**
 * Judge the session's final turn and store the verdict. The model runs only when the final turn changed: a new
 * turn end over the same assistant turn (an away summary) just restamps the stored verdict.
 */
export async function generateTurnVerdict(
	summariesDb: SummariesDb,
	{sessionId, filePath, turnEndedAt}: TurnVerdictRequest,
	runModel: RunModel = runClaude,
): Promise<TurnVerdict | null> {
	const turn = finalTurnFromLines(await readTailLines(filePath));
	if (turn === null) return null;
	const stored = summariesDb
		.select()
		.from(schema.turnVerdicts)
		.where(eq(schema.turnVerdicts.sessionId, sessionId))
		.get();
	let needsInput: boolean;
	if (stored?.turnUuid === turn.uuid) {
		needsInput = stored.needsInput === 1;
	} else {
		const parsed = parseTurnVerdict(await runModel(turnVerdictPrompt(turn.text)));
		if (parsed === null) return null;
		needsInput = parsed;
	}
	const row = {turnUuid: turn.uuid, turnEndedAt, needsInput: needsInput ? 1 : 0, generatedAt: Date.now()};
	summariesDb
		.insert(schema.turnVerdicts)
		.values({sessionId, ...row})
		.onConflictDoUpdate({target: schema.turnVerdicts.sessionId, set: row})
		.run();
	return {turnEndedAt, needsInput};
}

interface TurnVerdictWorker {
	summariesDb: SummariesDb;
	projectsDir: string;
	runModel: RunModel;
	onVerdict: (sessionId: string) => void;
}

interface TurnVerdictState {
	verdicts: Map<string, TurnVerdict>;
	queue: Map<string, {project: string; turnEndedAt: number}>;
	worker: TurnVerdictWorker | null;
	running: boolean;
}

const state = hmrPersist<TurnVerdictState>("turnVerdictState", () => ({
	verdicts: new Map(),
	queue: new Map(),
	worker: null,
	running: false,
}));

/** Whether the session's verdict for this turn end says the turn asks the user for input. */
export function turnVerdictNeedsInput(sessionId: string, turnEndedAt: number | undefined): boolean {
	const verdict = state.verdicts.get(sessionId);
	return verdict !== undefined && verdict.turnEndedAt === turnEndedAt && verdict.needsInput;
}

/**
 * Queue a verdict for an unread session whose turn has ended. A no-op until the worker starts (the server starts
 * it; tests and scripts never call the model), and when the verdict for this turn end is known or queued.
 */
export function requestTurnVerdict(sessionId: string, project: string, turnEndedAt: number, now: number): void {
	if (state.worker === null || now - turnEndedAt > MAX_TURN_AGE_MS) return;
	if (state.verdicts.get(sessionId)?.turnEndedAt === turnEndedAt) return;
	if (state.queue.get(sessionId)?.turnEndedAt === turnEndedAt) return;
	state.queue.set(sessionId, {project, turnEndedAt});
	void drainQueue();
}

async function drainQueue(): Promise<void> {
	if (state.running) return;
	state.running = true;
	try {
		for (const [sessionId, {project, turnEndedAt}] of state.queue) {
			state.queue.delete(sessionId);
			const worker = state.worker;
			if (worker === null) return;
			try {
				const verdict = await generateTurnVerdict(
					worker.summariesDb,
					{sessionId, filePath: join(worker.projectsDir, project, `${sessionId}.jsonl`), turnEndedAt},
					worker.runModel,
				);
				// A failed judgment still answers for this turn end, so the row does not requeue it on every read.
				state.verdicts.set(sessionId, verdict ?? {turnEndedAt, needsInput: false});
				if (verdict?.needsInput === true) worker.onVerdict(sessionId);
			} catch (err) {
				state.verdicts.set(sessionId, {turnEndedAt, needsInput: false});
				console.error(`Turn verdict failed for ${sessionId}:`, err);
			}
		}
	} finally {
		state.running = false;
	}
}

/** Load the stored verdicts and start judging requested turns; `onVerdict` rebroadcasts a session that now waits. */
export function startTurnVerdictWorker({
	summariesDb,
	projectsDir,
	runModel = runClaude,
	onVerdict,
}: Omit<TurnVerdictWorker, "runModel"> & {runModel?: RunModel}): () => void {
	for (const row of summariesDb.select().from(schema.turnVerdicts).all()) {
		state.verdicts.set(row.sessionId, {turnEndedAt: row.turnEndedAt, needsInput: row.needsInput === 1});
	}
	state.worker = {summariesDb, projectsDir, runModel, onVerdict};
	return () => {
		state.worker = null;
		state.queue.clear();
		state.verdicts.clear();
	};
}
