import {appendFileSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {createJsonlIndexCache, indexJsonlFile, indexSessionsIndex} from "../src/lib/db/indexer";
import {listRecentSessionsFromDb, getSessionMeta} from "../src/lib/db/queries";
import {getCurrentSessionMessageIndex, getSessionViewedState} from "../src/lib/db/viewed-state";
import {
	countActiveChainMessages,
	countMessageRecords,
	isCountableMessageRecord,
	mightBeCountableMessageLine,
} from "../src/lib/message-count";
import {readStructuredTranscript} from "../src/lib/structured-transcript";
import {listSessions, readSession} from "../src/lib/sessions";
import * as schema from "../src/lib/db/schema";
import {eq} from "drizzle-orm";

const testDir = join(tmpdir(), "claude-message-count-test-" + process.pid);
const projectId = "-Users-craig-projects-app";
const sessionId = "session-count-100";

const baseFields = {
	timestamp: "1999-12-31T00:00:00.000Z",
	sessionId,
	parentUuid: null,
	isSidechain: false,
	userType: "external",
	cwd: "/Users/craig/projects/app",
	gitBranch: "main",
	version: "2.1.71",
	entrypoint: "cli",
};

/**
 * Fixture transcript with exactly 4 countable messages:
 * two user turns and two assistant turns. The tool-result-only user record,
 * the sidechain assistant record, and the non-message records must not count.
 */
const fixtureRecords: Record<string, unknown>[] = [
	{
		type: "user",
		...baseFields,
		uuid: "uuid-1",
		message: {role: "user", content: "First user prompt"},
	},
	{
		type: "assistant",
		...baseFields,
		uuid: "uuid-2",
		message: {
			role: "assistant",
			content: [
				{type: "text", text: "First assistant reply"},
				{type: "tool_use", id: "toolu_1", name: "Bash", input: {command: "ls"}},
			],
		},
	},
	{
		// Tool-result-only user record: not a message.
		type: "user",
		...baseFields,
		uuid: "uuid-3",
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: "toolu_1", content: "file.txt"}],
		},
	},
	{
		type: "user",
		...baseFields,
		uuid: "uuid-4",
		message: {role: "user", content: [{type: "text", text: "Second user prompt"}]},
	},
	{
		// Sidechain record: not a message.
		type: "assistant",
		...baseFields,
		isSidechain: true,
		uuid: "uuid-5",
		message: {role: "assistant", content: [{type: "text", text: "Sidechain reply"}]},
	},
	{
		type: "assistant",
		...baseFields,
		uuid: "uuid-6",
		message: {role: "assistant", content: [{type: "text", text: "Second assistant reply"}]},
	},
	// Non-message records: never counted.
	{type: "system", subtype: "turn_duration", durationMs: 1200, uuid: "uuid-7"},
	{type: "summary", summary: "A short summary", leafUuid: "uuid-6"},
];

const EXPECTED_MESSAGE_COUNT = 4;

function jsonl(...lines: Record<string, unknown>[]): string {
	return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

let db: AppDb;

beforeEach(() => {
	mkdirSync(join(testDir, projectId), {recursive: true});
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

function writeFixtureTranscript(): string {
	const filePath = join(testDir, projectId, `${sessionId}.jsonl`);
	writeFileSync(filePath, jsonl(...fixtureRecords));
	return filePath;
}

describe("single message-count definition", () => {
	it("counts user and assistant turns, excluding tool-result records and sidechains", () => {
		expect(fixtureRecords.map((record) => isCountableMessageRecord(record))).toStrictEqual([
			true,
			true,
			false,
			true,
			false,
			true,
			false,
			false,
		]);
		expect(countMessageRecords(fixtureRecords)).toBe(EXPECTED_MESSAGE_COUNT);
	});

	it("the line prefilter accepts every line the record predicate would count", () => {
		// The prefilter exists only to skip a JSON.parse, so a false positive is
		// harmless but a false negative silently undercounts. Pin the direction
		// that matters against every fixture record, in the compact encoding the
		// CLI writes and in a whitespace-padded one it is still allowed to write.
		const encodings = fixtureRecords.flatMap((record) => [
			JSON.stringify(record),
			JSON.stringify(record).replaceAll('"type":', '"type" : '),
		]);

		const undercounted = encodings.filter(
			(line) => isCountableMessageRecord(JSON.parse(line)) && !mightBeCountableMessageLine(line),
		);

		expect(undercounted).toStrictEqual([]);
	});

	it("the line prefilter skips the record types that can never be messages", () => {
		const skipped = [
			{type: "summary", summary: "A short summary", leafUuid: "uuid-6"},
			{type: "system", subtype: "turn_duration", durationMs: 1200, uuid: "uuid-7"},
			{type: "attachment", uuid: "uuid-8", attachment: {type: "file", content: "text"}},
			{type: "queue-operation", uuid: "uuid-9", operation: "enqueue"},
			{type: "file-history-snapshot", uuid: "uuid-10", snapshot: {messageId: "m"}},
		];

		expect(skipped.map((record) => mightBeCountableMessageLine(JSON.stringify(record)))).toStrictEqual([
			false,
			false,
			false,
			false,
			false,
		]);
	});

	it("every surface reports the same count for the fixture transcript", async () => {
		const filePath = writeFixtureTranscript();
		await indexJsonlFile(db.index, filePath, projectId);

		const row = db.index
			.select({messageCount: schema.sessions.messageCount})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.get();
		const listEntry = listRecentSessionsFromDb(db.index, {limit: 10}).sessions.find(
			(session) => session.id === sessionId,
		);
		const meta = getSessionMeta(db.index, sessionId);
		const detail = await readSession(testDir, sessionId);
		const filesystemGroups = await listSessions(testDir);
		const filesystemEntry = filesystemGroups
			.flatMap((group) => group.sessions)
			.find((session) => session.id === sessionId);

		expect({
			indexedCount: row?.messageCount,
			listCount: listEntry?.messageCount,
			metaCount: meta?.messageCount,
			detailCount: detail?.messageCount,
			filesystemCount: filesystemEntry?.messageCount,
		}).toStrictEqual({
			indexedCount: EXPECTED_MESSAGE_COUNT,
			listCount: EXPECTED_MESSAGE_COUNT,
			metaCount: EXPECTED_MESSAGE_COUNT,
			detailCount: EXPECTED_MESSAGE_COUNT,
			filesystemCount: EXPECTED_MESSAGE_COUNT,
		});
	});

	it("newMessageCount derives from the same counter and can never exceed messageCount", async () => {
		const filePath = writeFixtureTranscript();
		await indexJsonlFile(db.index, filePath, projectId);

		const currentIndex = getCurrentSessionMessageIndex(db.index, sessionId);
		const neverViewed = getSessionViewedState(db.index, sessionId, currentIndex);
		// A stored index from the legacy raw-record unit (larger than any message
		// index) must clamp instead of producing a bogus count.
		const legacy = getSessionViewedState(db.index, sessionId, 999);

		expect({
			currentIndex,
			neverViewedNewCount: neverViewed.newMessageCount,
			neverViewedWithinTotal: neverViewed.newMessageCount <= EXPECTED_MESSAGE_COUNT,
			legacyWithinTotal: legacy.newMessageCount <= 1000,
		}).toStrictEqual({
			currentIndex: EXPECTED_MESSAGE_COUNT - 1,
			neverViewedNewCount: EXPECTED_MESSAGE_COUNT,
			neverViewedWithinTotal: true,
			legacyWithinTotal: true,
		});
	});

	it("sessions-index.json counts never overwrite the transcript-derived count", async () => {
		const filePath = writeFixtureTranscript();
		const projectDir = join(testDir, projectId);
		await indexJsonlFile(db.index, filePath, projectId);

		writeFileSync(
			join(projectDir, "sessions-index.json"),
			JSON.stringify({
				version: 1,
				entries: [
					{
						sessionId,
						fullPath: filePath,
						fileMtime: Date.now(),
						firstPrompt: "First user prompt",
						messageCount: 999,
						projectPath: "/Users/craig/projects/app",
					},
				],
			}),
		);
		await indexSessionsIndex(db.index, projectDir, projectId);

		const row = db.index
			.select({messageCount: schema.sessions.messageCount})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.get();
		expect(row?.messageCount).toBe(EXPECTED_MESSAGE_COUNT);
	});
});

/**
 * A pulled-back prompt: "do chapter 2" was sent, answered, then abandoned when
 * "do chapter 3" was re-parented onto the same assistant reply (the shape of
 * local session 649c3fab). Six countable records, four on the active chain.
 */
const forkedRecords: Record<string, unknown>[] = [
	{type: "user", ...baseFields, uuid: "f-1", message: {role: "user", content: "Write the novel"}},
	{
		type: "assistant",
		...baseFields,
		uuid: "f-2",
		parentUuid: "f-1",
		message: {role: "assistant", content: [{type: "text", text: "Chapter 1 done"}]},
	},
	{
		type: "user",
		...baseFields,
		uuid: "f-old",
		parentUuid: "f-2",
		timestamp: "1999-12-31T00:01:00.000Z",
		message: {role: "user", content: "do chapter 2"},
	},
	{
		type: "assistant",
		...baseFields,
		uuid: "f-old-reply",
		parentUuid: "f-old",
		message: {role: "assistant", content: [{type: "text", text: "Starting chapter 2"}]},
	},
	{
		type: "user",
		...baseFields,
		uuid: "f-new",
		parentUuid: "f-2",
		timestamp: "1999-12-31T00:02:00.000Z",
		message: {role: "user", content: "do chapter 3"},
	},
	{
		type: "assistant",
		...baseFields,
		uuid: "f-new-reply",
		parentUuid: "f-new",
		message: {role: "assistant", content: [{type: "text", text: "Chapter 3 done"}]},
	},
];

const EXPECTED_CHAIN_COUNT = 4;

function writeForkedTranscript(records: Record<string, unknown>[] = forkedRecords): string {
	const filePath = join(testDir, projectId, `${sessionId}.jsonl`);
	writeFileSync(filePath, jsonl(...records));
	return filePath;
}

describe("active-chain message counts", () => {
	it("counts only the records on the active chain", () => {
		expect({
			all: countMessageRecords(forkedRecords),
			chain: countActiveChainMessages(forkedRecords),
			visible: countMessageRecords(forkedRecords, new Set(["f-old", "f-old-reply"])),
		}).toStrictEqual({all: 6, chain: EXPECTED_CHAIN_COUNT, visible: EXPECTED_CHAIN_COUNT});
	});

	it("every surface leaves the abandoned branch out of the count", async () => {
		const filePath = writeForkedTranscript();
		await indexJsonlFile(db.index, filePath, projectId);

		const row = db.index
			.select({messageCount: schema.sessions.messageCount})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.get();
		const detail = await readSession(testDir, sessionId);
		const filesystemEntry = (await listSessions(testDir))
			.flatMap((group) => group.sessions)
			.find((session) => session.id === sessionId);

		expect({
			indexedCount: row?.messageCount,
			currentIndex: getCurrentSessionMessageIndex(db.index, sessionId),
			detailCount: detail?.messageCount,
			filesystemCount: filesystemEntry?.messageCount,
		}).toStrictEqual({
			indexedCount: EXPECTED_CHAIN_COUNT,
			currentIndex: EXPECTED_CHAIN_COUNT - 1,
			detailCount: EXPECTED_CHAIN_COUNT,
			filesystemCount: EXPECTED_CHAIN_COUNT,
		});
	});

	it("numbers a transcript window by the on-chain messages before it, matching the session counter", async () => {
		const filePath = writeForkedTranscript();
		await indexJsonlFile(db.index, filePath, projectId);

		const tail = readStructuredTranscript(db.index, sessionId, {maxRecords: 2});
		const hidden = new Set(tail.hiddenUuids);

		expect({
			startIndex: tail.startIndex,
			precedingMessageCount: tail.precedingMessageCount,
			currentMessageIndex: tail.precedingMessageCount + countMessageRecords(tail.records, hidden) - 1,
		}).toStrictEqual({
			startIndex: 4,
			precedingMessageCount: 2,
			currentMessageIndex: getCurrentSessionMessageIndex(db.index, sessionId),
		});
	});

	it("drops the abandoned branch from the incremental count when an append forks the chain", async () => {
		const cache = createJsonlIndexCache();
		const filePath = writeForkedTranscript(forkedRecords.slice(0, 4));
		await indexJsonlFile(db.index, filePath, projectId, {cache});
		const before = db.index
			.select({messageCount: schema.sessions.messageCount})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.get();

		appendFileSync(filePath, jsonl(...forkedRecords.slice(4)));
		const later = new Date(statSync(filePath).mtimeMs + 10_000);
		utimesSync(filePath, later, later);
		await indexJsonlFile(db.index, filePath, projectId, {cache});
		const after = db.index
			.select({messageCount: schema.sessions.messageCount})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.get();

		expect({before: before?.messageCount, after: after?.messageCount}).toStrictEqual({
			before: 4,
			after: EXPECTED_CHAIN_COUNT,
		});
	});
});
