import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {indexSubagentFile} from "../src/lib/db/indexer";
import {sessionSubagentsWithStops} from "../src/lib/db/subagent-stops";
import {workflowAgentStatuses} from "../src/lib/workflow-journal";

const testDir = join(tmpdir(), `claude-workflow-journal-test-${process.pid}`);
const projectId = "-Users-alice-projects-poems";
const sessionId = "session-alice-poems";
const runId = "wf_poems-1";
const sessionDir = join(testDir, projectId, sessionId);
const runDir = join(sessionDir, "subagents", "workflows", runId);

function jsonl(records: unknown[]): string {
	return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

/** started ×3, result ×1, failed ×1: a resumed run whose third agent never finished. */
const JOURNAL = jsonl([
	{type: "launched"},
	{type: "started", key: "k1", agentId: "a1", label: "poem-1", phase: "Draft"},
	{type: "started", key: "k2", agentId: "a2", label: "poem-2", phase: "Draft"},
	{type: "started", key: "k3", agentId: "a3", label: "poem-3", phase: "Draft"},
	{type: "result", key: "k1", agentId: "a1", result: "roses"},
	{type: "failed", key: "k2", agentId: "a2"},
]);

describe("workflowAgentStatuses", () => {
	it("takes each agent's state from its last journal event, and marks agents absent from the run file superseded", () => {
		expect(Object.fromEntries(workflowAgentStatuses(JOURNAL, new Set(["a1", "a2"])))).toStrictEqual({
			a1: {state: "done", attempt: "final"},
			a2: {state: "failed", attempt: "final"},
			a3: {state: "ended", attempt: "superseded"},
		});
	});

	it("keeps every agent final and an unfinished one running while the run has no run file", () => {
		expect(Object.fromEntries(workflowAgentStatuses(JOURNAL, null))).toStrictEqual({
			a1: {state: "done", attempt: "final"},
			a2: {state: "failed", attempt: "final"},
			a3: {state: "running", attempt: "final"},
		});
	});

	it("lets a later start after a failure (a retry) put the agent back to running", () => {
		const retried = jsonl([
			{type: "started", key: "k1", agentId: "a1"},
			{type: "failed", key: "k1", agentId: "a1"},
			{type: "started", key: "k1", agentId: "a1"},
		]);
		expect(Object.fromEntries(workflowAgentStatuses(retried, null))).toStrictEqual({
			a1: {state: "running", attempt: "final"},
		});
	});
});

describe("sessionSubagentsWithStops workflow attempts", () => {
	let db: AppDb;

	beforeEach(() => {
		mkdirSync(runDir, {recursive: true});
		mkdirSync(join(sessionDir, "workflows"), {recursive: true});
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
		rmSync(testDir, {recursive: true, force: true});
	});

	function writeAgent(agentId: string): string {
		const path = join(runDir, `agent-${agentId}.jsonl`);
		writeFileSync(
			path,
			jsonl([
				{
					type: "user",
					uuid: `${agentId}-u1`,
					isSidechain: true,
					agentId,
					sessionId,
					timestamp: "2026-10-20T10:00:00.000Z",
					message: {role: "user", content: "Write a poem"},
				},
			]),
		);
		return path;
	}

	it("adds each workflow agent's journal state and attempt, leaving other subagents untouched", async () => {
		writeFileSync(join(runDir, "journal.jsonl"), JOURNAL);
		writeFileSync(
			join(sessionDir, "workflows", `${runId}.json`),
			JSON.stringify({
				runId,
				status: "completed",
				workflowProgress: [
					{type: "workflow_phase", index: 1, title: "Draft"},
					{
						type: "workflow_agent",
						index: 1,
						label: "poem-1",
						phaseIndex: 1,
						phaseTitle: "Draft",
						agentId: "a1",
						state: "done",
					},
					{
						type: "workflow_agent",
						index: 2,
						label: "poem-2",
						phaseIndex: 1,
						phaseTitle: "Draft",
						agentId: "a2",
						state: "error",
					},
				],
			}),
		);
		for (const agentId of ["a1", "a2", "a3"])
			await indexSubagentFile(db.index, writeAgent(agentId), sessionId, projectId);
		const plainPath = join(sessionDir, "subagents", "agent-plain.jsonl");
		writeFileSync(
			plainPath,
			jsonl([
				{
					type: "user",
					uuid: "plain-u1",
					isSidechain: true,
					agentId: "plain",
					sessionId,
					timestamp: "2026-10-20T09:00:00.000Z",
					message: {role: "user", content: "Explore"},
				},
			]),
		);
		await indexSubagentFile(db.index, plainPath, sessionId, projectId);

		expect(
			sessionSubagentsWithStops(db.index, sessionId)
				.map(({id, workflowState, workflowAttempt}) => ({id, workflowState, workflowAttempt}))
				.toSorted((a, b) => a.id.localeCompare(b.id)),
		).toStrictEqual([
			{id: "agent-a1", workflowState: "done", workflowAttempt: "final"},
			{id: "agent-a2", workflowState: "failed", workflowAttempt: "final"},
			{id: "agent-a3", workflowState: "ended", workflowAttempt: "superseded"},
			{id: "agent-plain", workflowState: undefined, workflowAttempt: undefined},
		]);
	});
});
