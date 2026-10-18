import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {indexJsonlFile, indexSubagentFile} from "../src/lib/db/indexer";
import {getSubagentsForSession} from "../src/lib/db/queries";
import {DOMAIN_EVENTS} from "../src/lib/hook-events";
import {processJsonlAppend} from "../src/lib/watcher";
import {sessionSubagentsWithStops} from "../src/lib/db/subagent-stops";

const testDir = join(tmpdir(), `claude-teammate-index-test-${process.pid}`);
const projectId = "-Users-alice-projects-workflowy";
const sessionId = "session-alice-teams";

let db: AppDb;

beforeEach(() => {
	mkdirSync(join(testDir, projectId, sessionId, "subagents"), {recursive: true});
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

function jsonl(records: unknown[]): string {
	return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

/** A teammate's transcript and meta.json, shaped as the CLI writes in_process_teammate agents. */
function writeTeammate(agentId: string, name: string, description: string, startedAt: string): string {
	const dir = join(testDir, projectId, sessionId, "subagents");
	const path = join(dir, `agent-${agentId}.jsonl`);
	writeFileSync(
		path,
		jsonl([
			{
				type: "user",
				uuid: `${agentId}-u1`,
				isSidechain: true,
				agentId,
				sessionId,
				timestamp: startedAt,
				message: {role: "user", content: description},
			},
		]),
	);
	writeFileSync(
		join(dir, `agent-${agentId}.meta.json`),
		JSON.stringify({
			agentType: name,
			description,
			name,
			spawnDepth: 0,
			requestShape: "background",
			taskKind: "in_process_teammate",
			teamName: "session-81702b3f",
		}),
	);
	return path;
}

describe("teammate indexing", () => {
	it("records a teammate's kind and name, and marks the one a successful TaskStop named as stopped", async () => {
		const live = writeTeammate("ameetings-prep-1", "meetings-prep", "Meetings prep", "2026-10-13T21:36:54.870Z");
		const stopped = writeTeammate(
			"adistribute-prep-2",
			"distribute-prep",
			"Distribute candidates prep",
			"2026-10-13T22:07:50.961Z",
		);
		const mainPath = join(testDir, projectId, `${sessionId}.jsonl`);
		writeFileSync(
			mainPath,
			jsonl([
				{
					type: "assistant",
					uuid: "a1",
					sessionId,
					timestamp: "2026-10-13T22:13:10.057Z",
					message: {
						role: "assistant",
						content: [
							{type: "tool_use", id: "toolu_stop", name: "TaskStop", input: {task_id: "distribute-prep"}},
						],
					},
				},
				{
					type: "user",
					uuid: "u2",
					sessionId,
					timestamp: "2026-10-13T22:13:10.500Z",
					message: {
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "toolu_stop",
								content: "Stopped distribute-prep",
								is_error: false,
							},
						],
					},
				},
			]),
		);
		await indexJsonlFile(db.index, mainPath, projectId);
		await indexSubagentFile(db.index, live, sessionId, projectId);
		await indexSubagentFile(db.index, stopped, sessionId, projectId);

		expect(
			sessionSubagentsWithStops(db.index, sessionId)
				.map(({id, taskKind, name, stopped: isStopped}) => ({id, taskKind, name, stopped: isStopped}))
				.toSorted((a, b) => a.id.localeCompare(b.id)),
		).toStrictEqual([
			{id: "agent-adistribute-prep-2", taskKind: "in_process_teammate", name: "distribute-prep", stopped: true},
			{id: "agent-ameetings-prep-1", taskKind: "in_process_teammate", name: "meetings-prep", stopped: undefined},
		]);
		expect(getSubagentsForSession(db.index, sessionId).length).toBe(2);
	});

	it("keeps a teammate's in-flight foreground Bash as its pending command until the result lands, telling tabs each time it changes", async () => {
		const path = writeTeammate(
			"agrammar-fix-5",
			"grammar-fix",
			"Grammar fix: primitives not identifiers",
			"2026-10-14T00:04:57.000Z",
		);
		const call = {
			type: "assistant",
			uuid: "g-a1",
			isSidechain: true,
			agentId: "agrammar-fix-5",
			sessionId,
			timestamp: "2026-10-14T00:08:17.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_bench",
						name: "Bash",
						input: {command: "./bench.sh", description: "Run alternating corpus compile benchmarks"},
					},
				],
			},
		};
		const result = {
			type: "user",
			uuid: "g-u2",
			isSidechain: true,
			agentId: "agrammar-fix-5",
			sessionId,
			timestamp: "2026-10-14T00:12:00.000Z",
			message: {
				role: "user",
				content: [{type: "tool_result", tool_use_id: "toolu_bench", content: "done", is_error: false}],
			},
		};
		const offsets = new Map<string, number>();
		const broadcasts: string[] = [];
		const append = async (records: unknown[]) => {
			writeFileSync(
				path,
				jsonl([...[JSON.parse(readFileSync(path, "utf8").split("\n")[0]!) as unknown], ...records]),
			);
			await processJsonlAppend(
				db.index,
				path,
				offsets,
				(type, data) => {
					if (type === DOMAIN_EVENTS.SUBAGENTS_CHANGED) broadcasts.push(String(data["sessionId"]));
				},
				{projectsDir: testDir, plansDir: ""},
			);
			return getSubagentsForSession(db.index, sessionId)[0]?.pendingCommand ?? null;
		};

		const running = await append([call]);
		const finished = await append([call, result]);

		expect({running, finished, broadcasts}).toStrictEqual({
			running: "Run alternating corpus compile benchmarks",
			finished: null,
			broadcasts: [sessionId, sessionId],
		});
	});
	it("marks a teammate idle once its last turn ends, and mid-turn again when a message wakes it, telling tabs each time it changes", async () => {
		const path = writeTeammate("auta-a-1", "uta-a", "Upstream task A", "2026-10-13T09:00:00.000Z");
		const handback = {
			type: "assistant",
			uuid: "t-a1",
			isSidechain: true,
			agentId: "auta-a-1",
			sessionId,
			timestamp: "2026-10-13T09:58:05.000Z",
			message: {role: "assistant", stop_reason: "end_turn", content: [{type: "text", text: "Done."}]},
		};
		const reminder = {
			type: "attachment",
			uuid: "t-at2",
			isSidechain: true,
			agentId: "auta-a-1",
			sessionId,
			timestamp: "2026-10-13T09:58:06.000Z",
			attachment: {type: "todo_reminder", content: [], itemCount: 0},
		};
		const wake = {
			type: "user",
			uuid: "t-u3",
			isSidechain: true,
			agentId: "auta-a-1",
			sessionId,
			timestamp: "2026-10-13T10:10:00.000Z",
			message: {role: "user", content: "Another Claude session sent a message while you were working:"},
		};
		const offsets = new Map<string, number>();
		const broadcasts: string[] = [];
		const append = async (records: unknown[]) => {
			writeFileSync(
				path,
				jsonl([...[JSON.parse(readFileSync(path, "utf8").split("\n")[0]!) as unknown], ...records]),
			);
			await processJsonlAppend(
				db.index,
				path,
				offsets,
				(type, data) => {
					if (type === DOMAIN_EVENTS.SUBAGENTS_CHANGED) broadcasts.push(String(data["sessionId"]));
				},
				{projectsDir: testDir, plansDir: ""},
			);
			return sessionSubagentsWithStops(db.index, sessionId)[0]?.idle;
		};

		const idle = await append([handback, reminder]);
		const woken = await append([handback, reminder, wake]);

		expect({idle, woken, broadcasts}).toStrictEqual({
			idle: true,
			woken: undefined,
			broadcasts: [sessionId, sessionId],
		});
	});
});
