import {mkdirSync, rmSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {asc} from "drizzle-orm";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {indexJsonlFile, indexSubagentFile} from "../src/lib/db/indexer";
import * as schema from "../src/lib/db/schema";

const testDir = join(tmpdir(), `claude-artifacts-index-test-${process.pid}`);
const projectId = "-Users-alice-projects-ladder";
const sessionA = "session-alice-a";
const sessionB = "session-alice-b";
const ARTIFACT_ID = "546d3910-4e9a-4730-9e91-62742a47c7c6";
const ARTIFACT_URL = `https://claude.ai/code/artifact/${ARTIFACT_ID}`;
const OTHER_ID = "17b8a2c1-4c41-46bf-b064-a272240be709";
const OTHER_URL = `https://claude.ai/code/artifact/${OTHER_ID}`;
const SOURCE_A = "/Users/alice/projects/ladder/.llm/rebalance-ui.html";
const SOURCE_B = "/Users/alice/projects/ladder/.llm/rebalance-queue.html";

interface ArtifactCall {
	toolUseId: string;
	timestamp: string;
	input: Record<string, unknown>;
	resultText: string;
	toolUseResult: unknown;
	isError?: boolean;
}

function artifactCallRecords(sessionId: string, call: ArtifactCall): unknown[] {
	return [
		{
			type: "assistant",
			uuid: `${call.toolUseId}-use`,
			sessionId,
			timestamp: call.timestamp,
			message: {
				role: "assistant",
				content: [{type: "tool_use", id: call.toolUseId, name: "Artifact", input: call.input}],
			},
		},
		{
			type: "user",
			uuid: `${call.toolUseId}-result`,
			sessionId,
			timestamp: call.timestamp,
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: call.toolUseId,
						content: [{type: "text", text: call.resultText}],
						is_error: call.isError ?? false,
					},
				],
			},
			toolUseResult: call.toolUseResult,
		},
	];
}

function publishResult(url: string, path: string, title: string, version: string) {
	return {
		url,
		path,
		title,
		updated: true,
		audience: "owner",
		version,
		liveSubscription: "connected",
	};
}

const firstPublish: ArtifactCall = {
	toolUseId: "toolu_a_publish",
	timestamp: "2000-01-01T00:00:00.000Z",
	input: {
		file_path: SOURCE_A,
		title: "Asap Ladder Rebalance",
		description: "Drag tasks between tiers.",
		favicon: "🪜",
	},
	resultText: `Published ${SOURCE_A} at ${ARTIFACT_URL}\n\nLive subscription: connected.`,
	toolUseResult: publishResult(ARTIFACT_URL, SOURCE_A, "Asap Ladder Rebalance", "v1"),
};

const readDb: ArtifactCall = {
	toolUseId: "toolu_a_read_db",
	timestamp: "2000-01-01T01:00:00.000Z",
	input: {action: "read_db", url: ARTIFACT_URL, db_op: "list", collection: "rebalance"},
	resultText: '0 documents from collection "rebalance".',
	toolUseResult: {db_read: {op: "list", collection: "rebalance", docs: []}},
};

const failedPublish: ArtifactCall = {
	toolUseId: "toolu_a_error",
	timestamp: "2000-01-01T02:00:00.000Z",
	input: {file_path: SOURCE_A, url: ARTIFACT_URL, favicon: "💥"},
	resultText: `Could not publish to ${ARTIFACT_URL}: rate-limited.`,
	toolUseResult: "Error: rate-limited",
	isError: true,
};

const listCall: ArtifactCall = {
	toolUseId: "toolu_a_list",
	timestamp: "2000-01-01T03:00:00.000Z",
	input: {action: "list", limit: 10},
	resultText: `1 published artifact:\n- Elsewhere — ${OTHER_URL}`,
	toolUseResult: {
		artifacts: [{title: "Elsewhere", url: OTHER_URL, updatedAt: "2000-01-01T00:00:00Z"}],
		truncated: false,
	},
};

const secondPublish: ArtifactCall = {
	toolUseId: "toolu_b_publish",
	timestamp: "2000-01-02T00:00:00.000Z",
	input: {
		file_path: SOURCE_B,
		url: ARTIFACT_URL,
		description: "One continuous queue.",
		favicon: "📌",
	},
	resultText: `Published ${SOURCE_B} at ${ARTIFACT_URL} (Version 2, version id v2)\n\nDone.`,
	toolUseResult: publishResult(ARTIFACT_URL, SOURCE_B, "Asap Ladder Queue", "v2"),
};

const subagentPin: ArtifactCall = {
	toolUseId: "toolu_b_sub_pin",
	timestamp: "2000-01-02T01:00:00.000Z",
	input: {action: "pin", url: `${ARTIFACT_URL}/`},
	resultText: `Pinned ${ARTIFACT_URL}.`,
	toolUseResult: "Pinned.",
};

let db: AppDb;

function writeTranscript(path: string, sessionId: string, calls: ArtifactCall[]): string {
	const records = [
		{
			type: "user",
			uuid: `${sessionId}-prompt`,
			sessionId,
			timestamp: "2000-01-01T00:00:00.000Z",
			cwd: "/Users/alice/projects/ladder",
			message: {role: "user", content: "Build the ladder page"},
		},
		...calls.flatMap((call) => artifactCallRecords(sessionId, call)),
	];
	writeFileSync(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
	return path;
}

function sessionPath(sessionId: string): string {
	return join(testDir, projectId, `${sessionId}.jsonl`);
}

function subagentPath(sessionId: string): string {
	const dir = join(testDir, projectId, sessionId, "subagents");
	mkdirSync(dir, {recursive: true});
	return join(dir, "agent-pinner.jsonl");
}

function bumpMtime(path: string, seconds: number): void {
	utimesSync(path, seconds, seconds);
}

function readArtifacts() {
	return db.index.select().from(schema.artifacts).orderBy(asc(schema.artifacts.url)).all();
}

function readEvents() {
	return db.index
		.select()
		.from(schema.artifactEvents)
		.orderBy(asc(schema.artifactEvents.ts), asc(schema.artifactEvents.toolUseId))
		.all();
}

const expectedArtifactAfterBothSessions = {
	url: ARTIFACT_URL,
	id: ARTIFACT_ID,
	urlKind: "uuid",
	title: "Asap Ladder Queue",
	favicon: "🪜",
	description: "One continuous queue.",
	sourcePath: SOURCE_B,
	version: "v2",
	audience: "owner",
	firstSeenAt: Date.parse("2000-01-01T00:00:00.000Z"),
	lastPublishedAt: Date.parse("2000-01-02T00:00:00.000Z"),
	publishCount: 2,
	lastSessionId: sessionB,
	projectId,
};

const expectedEventsAfterBothSessions = [
	{
		toolUseId: "toolu_a_publish",
		sessionId: sessionA,
		projectId,
		filePath: sessionPath(sessionA),
		ts: Date.parse("2000-01-01T00:00:00.000Z"),
		action: "publish",
		url: ARTIFACT_URL,
		isSubagent: 0,
		title: "Asap Ladder Rebalance",
		favicon: "🪜",
		description: "Drag tasks between tiers.",
		sourcePath: SOURCE_A,
		version: "v1",
		audience: "owner",
	},
	{
		toolUseId: "toolu_a_read_db",
		sessionId: sessionA,
		projectId,
		filePath: sessionPath(sessionA),
		ts: Date.parse("2000-01-01T01:00:00.000Z"),
		action: "read_db",
		url: ARTIFACT_URL,
		isSubagent: 0,
		title: null,
		favicon: null,
		description: null,
		sourcePath: null,
		version: null,
		audience: null,
	},
	{
		toolUseId: "toolu_b_publish",
		sessionId: sessionB,
		projectId,
		filePath: sessionPath(sessionB),
		ts: Date.parse("2000-01-02T00:00:00.000Z"),
		action: "publish",
		url: ARTIFACT_URL,
		isSubagent: 0,
		title: "Asap Ladder Queue",
		favicon: "📌",
		description: "One continuous queue.",
		sourcePath: SOURCE_B,
		version: "v2",
		audience: "owner",
	},
];

beforeEach(() => {
	mkdirSync(join(testDir, projectId), {recursive: true});
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

describe("artifact indexing", () => {
	it("merges republishes of one URL across sessions into one artifact", async () => {
		writeTranscript(sessionPath(sessionA), sessionA, [firstPublish, readDb, failedPublish, listCall]);
		writeTranscript(sessionPath(sessionB), sessionB, [secondPublish]);

		await indexJsonlFile(db.index, sessionPath(sessionA), projectId);
		await indexJsonlFile(db.index, sessionPath(sessionB), projectId);

		expect(readArtifacts()).toStrictEqual([expectedArtifactAfterBothSessions]);
		expect(readEvents()).toStrictEqual(expectedEventsAfterBothSessions);
	});

	it("reindexes idempotently", async () => {
		writeTranscript(sessionPath(sessionA), sessionA, [firstPublish, readDb, failedPublish]);
		writeTranscript(sessionPath(sessionB), sessionB, [secondPublish]);
		await indexJsonlFile(db.index, sessionPath(sessionA), projectId);
		await indexJsonlFile(db.index, sessionPath(sessionB), projectId);

		bumpMtime(sessionPath(sessionA), 1_000_000);
		bumpMtime(sessionPath(sessionB), 1_000_000);
		await indexJsonlFile(db.index, sessionPath(sessionA), projectId);
		await indexJsonlFile(db.index, sessionPath(sessionB), projectId);

		expect(readArtifacts()).toStrictEqual([expectedArtifactAfterBothSessions]);
		expect(readEvents()).toStrictEqual(expectedEventsAfterBothSessions);
	});

	it("recomputes the artifact when a session's publish disappears on reindex", async () => {
		writeTranscript(sessionPath(sessionA), sessionA, [firstPublish]);
		writeTranscript(sessionPath(sessionB), sessionB, [secondPublish]);
		await indexJsonlFile(db.index, sessionPath(sessionA), projectId);
		await indexJsonlFile(db.index, sessionPath(sessionB), projectId);

		writeTranscript(sessionPath(sessionB), sessionB, []);
		bumpMtime(sessionPath(sessionB), 1_000_000);
		await indexJsonlFile(db.index, sessionPath(sessionB), projectId);

		expect(readArtifacts()).toStrictEqual([
			{
				url: ARTIFACT_URL,
				id: ARTIFACT_ID,
				urlKind: "uuid",
				title: "Asap Ladder Rebalance",
				favicon: "🪜",
				description: "Drag tasks between tiers.",
				sourcePath: SOURCE_A,
				version: "v1",
				audience: "owner",
				firstSeenAt: Date.parse("2000-01-01T00:00:00.000Z"),
				lastPublishedAt: Date.parse("2000-01-01T00:00:00.000Z"),
				publishCount: 1,
				lastSessionId: sessionA,
				projectId,
			},
		]);
	});

	it("records subagent calls under the parent session without clobbering its events", async () => {
		writeTranscript(sessionPath(sessionB), sessionB, [secondPublish]);
		const agentPath = writeTranscript(subagentPath(sessionB), sessionB, [subagentPin]);

		await indexJsonlFile(db.index, sessionPath(sessionB), projectId);
		await indexSubagentFile(db.index, agentPath, sessionB, projectId);
		bumpMtime(sessionPath(sessionB), 1_000_000);
		await indexJsonlFile(db.index, sessionPath(sessionB), projectId);

		expect(
			readEvents().map(({toolUseId, action, url, isSubagent, filePath}) => ({
				toolUseId,
				action,
				url,
				isSubagent,
				filePath,
			})),
		).toStrictEqual([
			{
				toolUseId: "toolu_b_publish",
				action: "publish",
				url: ARTIFACT_URL,
				isSubagent: 0,
				filePath: sessionPath(sessionB),
			},
			{
				toolUseId: "toolu_b_sub_pin",
				action: "pin",
				url: ARTIFACT_URL,
				isSubagent: 1,
				filePath: agentPath,
			},
		]);
		expect(readArtifacts()).toStrictEqual([
			{
				url: ARTIFACT_URL,
				id: ARTIFACT_ID,
				urlKind: "uuid",
				title: "Asap Ladder Queue",
				favicon: "📌",
				description: "One continuous queue.",
				sourcePath: SOURCE_B,
				version: "v2",
				audience: "owner",
				firstSeenAt: Date.parse("2000-01-02T00:00:00.000Z"),
				lastPublishedAt: Date.parse("2000-01-02T00:00:00.000Z"),
				publishCount: 1,
				lastSessionId: sessionB,
				projectId,
			},
		]);
	});
});
