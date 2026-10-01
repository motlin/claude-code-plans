import {readFileSync} from "node:fs";
import {basename} from "node:path";
import {mergeTranscriptData, transcriptEndIndex, type TranscriptData} from "../../src/lib/api/sessions";
import {openTestDb} from "../../src/lib/db/connection";
import * as schema from "../../src/lib/db/schema";
import {DOMAIN_EVENTS, SSE_EVENTS} from "../../src/lib/hook-events";
import {claudeEventsReducer, type ClaudeEventsAction, type ClaudeEventsState} from "../../src/hooks/use-claude-events";
import {titleMatches} from "../../src/lib/search-text";
import {readStructuredTranscript} from "../../src/lib/structured-transcript";
import {processTranscript} from "../../src/lib/transcript";
import {generateTranscript, PERF_SHAPES, type PerfShapeName} from "./fixtures/generate-transcript";
import {HOT_PATH_FIXED_SHAPES, type HotPathFixedFn, type HotPathFn, type HotPathShapedFn} from "./perf-ids";

/**
 * The inputs for each hot path in tests/perf/run-hot-path.mjs (measurement plan §2.4 L5). Preparing builds the input
 * outside the measured window and returns the one call the harness counts.
 */

const APPENDED_LINES = 20;

function isShapeName(shape: string): shape is PerfShapeName {
	return Object.hasOwn(PERF_SHAPES, shape);
}

async function prepareShaped(fn: HotPathShapedFn, shape: string): Promise<() => unknown> {
	if (!isShapeName(shape)) throw new Error(`unknown perf shape ${shape}`);
	const file = await generateTranscript(PERF_SHAPES[shape]);
	const sessionId = basename(file, ".jsonl");
	const db = openTestDb();
	db.index.insert(schema.projects).values({id: "-repo", name: "repo", updatedAt: 0}).run();
	db.index
		.insert(schema.sessions)
		.values({id: sessionId, projectId: "-repo", title: sessionId, createdAt: 0, mtimeMs: 0, filePath: file})
		.run();

	switch (fn) {
		case "readStructuredTranscript":
			return () => readStructuredTranscript(db.index, sessionId);
		case "processTranscript": {
			const {records} = readStructuredTranscript(db.index, sessionId);
			return () => processTranscript(records);
		}
		case "mergeTranscriptData": {
			// The live-append path: the cached tail window, then the next lines the watcher sends.
			const lines = readFileSync(file, "utf8")
				.split("\n")
				.filter((line) => line.trim());
			const old = readStructuredTranscript(db.index, sessionId, {before: lines.length - APPENDED_LINES});
			const appended: TranscriptData = {
				records: lines
					.slice(-APPENDED_LINES)
					.map((line) => JSON.parse(line) as TranscriptData["records"][number]),
				byteOffset: old.byteOffset,
				startIndex: transcriptEndIndex(old as TranscriptData),
				precedingMessageCount: old.precedingMessageCount,
			};
			return () => mergeTranscriptData(old as TranscriptData, appended);
		}
	}
}

/** Ten sessions, each walking one lifecycle of twenty events, interleaved. */
function replayEvents(): ClaudeEventsAction[] {
	const steps = [
		SSE_EVENTS.SESSION_START,
		DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
		DOMAIN_EVENTS.SESSION_TOOL_PENDING,
		DOMAIN_EVENTS.SESSION_LINES_APPENDED,
		DOMAIN_EVENTS.SESSION_UPDATED,
		DOMAIN_EVENTS.SUBAGENT_STARTED,
		DOMAIN_EVENTS.SESSION_TOOL_PENDING,
		DOMAIN_EVENTS.SESSION_TOOL_FAILED,
		DOMAIN_EVENTS.SESSION_LINES_APPENDED,
		DOMAIN_EVENTS.NOTIFICATION,
		DOMAIN_EVENTS.SUBAGENT_STOPPED,
		DOMAIN_EVENTS.SESSION_COMPACTING,
		DOMAIN_EVENTS.SESSION_COMPACTED,
		DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
		DOMAIN_EVENTS.SESSION_TOOL_PENDING,
		DOMAIN_EVENTS.SESSION_LINES_APPENDED,
		DOMAIN_EVENTS.SESSION_UPDATED,
		DOMAIN_EVENTS.NOTIFICATION,
		DOMAIN_EVENTS.SESSION_ENDED,
		SSE_EVENTS.SESSION_END,
	];
	const sessions = 10;
	const events: ClaudeEventsAction[] = [];
	for (const [step, eventType] of steps.entries()) {
		for (let session = 0; session < sessions; session += 1) {
			const sessionId = `session-${session}`;
			events.push({
				type: "SSE_EVENT",
				eventType,
				timestamp: 1_700_000_000_000 + events.length * 1000,
				data: {
					sessionId,
					session: {id: sessionId},
					cwd: `/repo/${session}`,
					model: "claude-opus",
					sessionTitle: `Session ${session}`,
					permissionMode: "default",
					toolName: "Bash",
					toolUseId: `tool-${session}-${step}`,
					error: "exit 1",
					message: "Claude is waiting for your input",
					agentType: "Explore",
					agentId: `agent-${session}`,
					description: "Search the codebase",
				},
			});
		}
	}
	return events;
}

const TITLE_WORDS = [
	"fix",
	"add",
	"perf",
	"test",
	"session",
	"transcript",
	"sidebar",
	"palette",
	"refactor",
	"the",
	"watcher",
	"schema",
	"render",
	"query",
	"cache",
	"herdr",
	"layout",
	"search",
];

/** Session titles from a fixed linear congruential sequence, so every run sees the same 500 titles. */
function paletteTitles(count: number): string[] {
	let seed = 1;
	const next = () => {
		seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
		return seed;
	};
	return Array.from({length: count}, () =>
		Array.from({length: 3 + (next() % 6)}, () => TITLE_WORDS[next() % TITLE_WORDS.length]!).join(" "),
	);
}

const PALETTE_QUERIES = ["fix", "perf test", "session sidebar", "zzz", "the cache"];

function prepareFixed(fn: HotPathFixedFn): () => unknown {
	switch (fn) {
		case "claudeEventsReducer": {
			const events = replayEvents();
			const initial = claudeEventsReducer({} as ClaudeEventsState, {type: "RESET"});
			return () => events.reduce(claudeEventsReducer, initial);
		}
		case "paletteRanking": {
			// The palette's instant rows: every cached session title against the query, as the user types it.
			const titles = paletteTitles(500);
			return () => PALETTE_QUERIES.map((query) => titles.filter((title) => titleMatches(title, query) !== null));
		}
	}
}

export async function prepareHotPath(fn: HotPathFn, shape: string): Promise<() => unknown> {
	if (fn === "claudeEventsReducer" || fn === "paletteRanking") {
		if (shape !== HOT_PATH_FIXED_SHAPES[fn]) throw new Error(`${fn} runs only on ${HOT_PATH_FIXED_SHAPES[fn]}`);
		return prepareFixed(fn);
	}
	return prepareShaped(fn, shape);
}
