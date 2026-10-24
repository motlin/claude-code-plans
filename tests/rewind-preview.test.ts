import {describe, expect, it} from "vite-plus/test";
import {openTestDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {handleRewindFilesPreview, previewRewindFiles} from "../src/lib/rewind-preview";
import {parseJsonlRecord, type JsonlRecord} from "../src/lib/schemas";

const SESSION_ID = "session-rewind-200";

function record(value: Record<string, unknown>): JsonlRecord {
	const parsed = parseJsonlRecord(JSON.stringify(value));
	if (parsed === null) throw new Error(`Invalid JSONL fixture: ${JSON.stringify(value)}`);
	return parsed;
}

function userPrompt(uuid: string, text: string): JsonlRecord {
	return record({
		type: "user",
		uuid,
		parentUuid: null,
		sessionId: SESSION_ID,
		timestamp: "2026-10-24T00:00:00.000Z",
		message: {role: "user", content: text},
	});
}

function snapshot(messageId: string): JsonlRecord {
	return record({
		type: "file-history-snapshot",
		messageId,
		isSnapshotUpdate: false,
		snapshot: {messageId, timestamp: "2026-10-24T00:00:00.000Z", trackedFileBackups: {}},
	});
}

function editResult(uuid: string, filePath: string, originalFile: string, from: string, to: string): JsonlRecord {
	return record({
		type: "user",
		uuid,
		parentUuid: `assistant-${uuid}`,
		sessionId: SESSION_ID,
		timestamp: "2026-10-24T00:00:00.000Z",
		message: {role: "user", content: [{type: "tool_result", tool_use_id: `toolu_${uuid}`, content: "ok"}]},
		toolUseResult: {
			filePath,
			oldString: from,
			newString: to,
			originalFile,
			structuredPatch: [{oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: []}],
			userModified: false,
			replaceAll: false,
		},
		sourceToolAssistantUUID: `assistant-${uuid}`,
	});
}

/** Prompt 1 edits a.txt; prompt 2 edits a.txt again and b.txt. Prompts 1 and 2 have checkpoints. */
function sessionRecords(): JsonlRecord[] {
	return [
		snapshot("prompt-1"),
		userPrompt("prompt-1", "First"),
		editResult("edit-1", "/repo/a.txt", "one\ntwo\n", "one", "ONE"),
		snapshot("prompt-2"),
		userPrompt("prompt-2", "Second"),
		editResult("edit-2", "/repo/a.txt", "ONE\ntwo\n", "two", "TWO"),
		editResult("edit-3", "/repo/b.txt", "alpha\n", "alpha", "beta\ngamma"),
		userPrompt("prompt-3", "Third"),
	];
}

describe("previewRewindFiles", () => {
	it("counts every file edit from the message to the end", () => {
		expect(previewRewindFiles(sessionRecords(), "prompt-1")).toStrictEqual({
			canRewind: true,
			filesChanged: ["/repo/a.txt", "/repo/b.txt"],
			insertions: 4,
			deletions: 3,
		});
	});

	it("leaves out edits made before the message", () => {
		expect(previewRewindFiles(sessionRecords(), "prompt-2")).toStrictEqual({
			canRewind: true,
			filesChanged: ["/repo/a.txt", "/repo/b.txt"],
			insertions: 3,
			deletions: 2,
		});
	});

	it("can't rewind the code of a message without a file checkpoint", () => {
		expect(previewRewindFiles(sessionRecords(), "prompt-3")).toStrictEqual({
			canRewind: false,
			filesChanged: [],
			insertions: 0,
			deletions: 0,
		});
	});

	it("can't rewind the code of an unknown message", () => {
		expect(previewRewindFiles(sessionRecords(), "missing")).toStrictEqual({
			canRewind: false,
			filesChanged: [],
			insertions: 0,
			deletions: 0,
		});
	});
});

function dependencies(restoring = false) {
	const db = openTestDb();
	db.index
		.insert(schema.projects)
		.values({id: "project-rewind-200", name: "example", projectPath: "/example", updatedAt: 0})
		.run();
	db.index
		.insert(schema.sessions)
		.values({
			id: SESSION_ID,
			projectId: "project-rewind-200",
			title: "Rewind example",
			firstPrompt: null,
			summary: null,
			customTitle: null,
			messageCount: 8,
			gitBranch: null,
			cwd: "/repo",
			isSidechain: 0,
			createdAt: 946_598_400_000,
			mtimeMs: 946_684_800_000,
			filePath: `/transcripts/${SESSION_ID}.jsonl`,
		})
		.run();
	return {
		index: db.index,
		readRecords: async () => Promise.resolve(sessionRecords()),
		restoring: () => restoring,
	};
}

async function get(sessionId: string, query: string, restoring = false) {
	const response = await handleRewindFilesPreview(
		sessionId,
		new Request(`http://localhost/api/sessions/${sessionId}/rewind-files${query}`),
		dependencies(restoring),
	);
	return {status: response.status, body: (await response.json()) as unknown};
}

describe("handleRewindFilesPreview", () => {
	it("dry-runs the code restore for a message", async () => {
		expect(await get(SESSION_ID, "?message=prompt-2")).toStrictEqual({
			status: 200,
			body: {canRewind: true, filesChanged: ["/repo/a.txt", "/repo/b.txt"], insertions: 3, deletions: 2},
		});
	});

	it("answers inFlight while a restore for the session still runs", async () => {
		expect(await get(SESSION_ID, "?message=prompt-2", true)).toStrictEqual({
			status: 200,
			body: {inFlight: true},
		});
	});

	it("requires a message and a known session", async () => {
		expect([await get(SESSION_ID, ""), await get("missing", "?message=prompt-2")]).toStrictEqual([
			{status: 400, body: {error: "A message is required"}},
			{status: 404, body: {error: "Session not found"}},
		]);
	});
});
