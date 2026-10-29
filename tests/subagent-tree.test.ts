import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SubagentTypeBadges} from "../src/components/subagent-tree";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {getSubagentsForSession} from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";
import {buildSubagentTree, groupSubagentTreeByDate, type SubagentTreeEntry} from "../src/lib/subagent-tree";
import {extractPendingSubagents, toClientSubagent, type Subagent} from "../src/lib/subagents";
import {phaseAriaLabel} from "../src/lib/workflow-progress";

function makeAgent(overrides: Partial<Subagent> & {id: string}): Subagent {
	return {
		sessionId: "session-test",
		projectId: "project-test",
		parentAgentId: null,
		agentType: "general-purpose",
		attributionAgent: null,
		slug: null,
		description: null,
		model: null,
		startedAt: null,
		finishedAt: null,
		...overrides,
	};
}

type TreeSummary =
	| {kind: "agent"; id: string; children: TreeSummary[]}
	| {kind: "parallel"; wallClockMs: number; children: TreeSummary[]}
	| {kind: "run"; runId: string; name: string; phases: {title: string; agents: TreeSummary[]}[]};

function summarizeTree(entries: SubagentTreeEntry[]): TreeSummary[] {
	return entries.map((entry): TreeSummary => {
		if ("type" in entry && entry.type === "workflow-run") {
			return {
				kind: "run",
				runId: entry.runId,
				name: entry.name,
				phases: entry.phases.map((phase) => ({title: phase.title, agents: summarizeTree(phase.agents)})),
			};
		}
		if ("type" in entry) {
			return {
				kind: "parallel",
				wallClockMs: entry.wallClockMs,
				children: entry.children.map((child) => ({
					kind: "agent",
					id: child.agent.id,
					children: summarizeTree(child.children),
				})),
			};
		}
		return {
			kind: "agent",
			id: entry.agent.id,
			children: summarizeTree(entry.children),
		};
	});
}

describe("SubagentTypeBadges", () => {
	it("shows transcript attribution beside launch metadata", () => {
		const html = renderToStaticMarkup(
			createElement(SubagentTypeBadges, {
				agentType: "Explore",
				attributionAgent: "markdown-tasks:do-task",
				model: null,
			}),
		);

		expect(html).toContain("Explore");
		expect(html).toContain("markdown-tasks:do-task");
		expect(html).toContain('title="Transcript attribution agent"');
	});

	it("renders one badge when the attribution agent equals the agent type", () => {
		const html = renderToStaticMarkup(
			createElement(SubagentTypeBadges, {
				agentType: "workflow-subagent",
				attributionAgent: "workflow-subagent",
				model: null,
			}),
		);

		expect(html).toBe(
			'<span class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-500/15 text-gray-400">workflow-subagent</span>',
		);
	});

	it("names the model the agent ran on rather than its raw id", () => {
		const html = renderToStaticMarkup(
			createElement(SubagentTypeBadges, {
				agentType: "Explore",
				attributionAgent: null,
				model: "claude-haiku-4-5-20251001",
			}),
		);

		expect(html).toContain("Haiku 4.5");
		expect(html).not.toContain("claude-haiku-4-5-20251001");
	});

	it("shows no model when the record names none", () => {
		const synthetic = renderToStaticMarkup(
			createElement(SubagentTypeBadges, {
				agentType: "Explore",
				attributionAgent: null,
				model: "<synthetic>",
			}),
		);
		const missing = renderToStaticMarkup(
			createElement(SubagentTypeBadges, {
				agentType: "Explore",
				attributionAgent: null,
				model: null,
			}),
		);

		expect(synthetic).toStrictEqual(missing);
		expect(missing).not.toContain("text-t6");
	});
});

describe("buildSubagentTree", () => {
	it("builds a flat list for serial agents", () => {
		const agents = [
			makeAgent({
				id: "agent-a",
				startedAt: "1999-12-31T00:00:00.000Z",
				finishedAt: "1999-12-31T00:00:10.000Z",
			}),
			makeAgent({
				id: "agent-b",
				startedAt: "1999-12-31T00:00:15.000Z",
				finishedAt: "1999-12-31T00:00:25.000Z",
			}),
			makeAgent({
				id: "agent-c",
				startedAt: "1999-12-31T00:00:30.000Z",
				finishedAt: "1999-12-31T00:00:40.000Z",
			}),
		];

		expect(summarizeTree(buildSubagentTree(agents))).toStrictEqual([
			{kind: "agent", id: "agent-a", children: []},
			{kind: "agent", id: "agent-b", children: []},
			{kind: "agent", id: "agent-c", children: []},
		]);
	});

	it("groups siblings started within two seconds but not at the boundary", () => {
		const agents = [
			makeAgent({
				id: "agent-a",
				startedAt: "1999-12-31T00:00:00.000Z",
				finishedAt: "1999-12-31T00:00:10.000Z",
			}),
			makeAgent({
				id: "agent-b",
				startedAt: "1999-12-31T00:00:01.999Z",
				finishedAt: "1999-12-31T00:00:16.999Z",
			}),
			makeAgent({
				id: "agent-c",
				startedAt: "1999-12-31T00:00:02.000Z",
				finishedAt: "1999-12-31T00:00:07.000Z",
			}),
		];

		expect(summarizeTree(buildSubagentTree(agents))).toStrictEqual([
			{
				kind: "parallel",
				wallClockMs: 15_000,
				children: [
					{kind: "agent", id: "agent-a", children: []},
					{kind: "agent", id: "agent-b", children: []},
				],
			},
			{kind: "agent", id: "agent-c", children: []},
		]);
	});

	it("nests children under their parent", () => {
		const agents = [
			makeAgent({
				id: "agent-parent",
				startedAt: "1999-12-31T00:00:00.000Z",
				finishedAt: "1999-12-31T00:00:30.000Z",
			}),
			makeAgent({
				id: "agent-child",
				parentAgentId: "agent-parent",
				startedAt: "1999-12-31T00:00:05.000Z",
				finishedAt: "1999-12-31T00:00:15.000Z",
			}),
		];

		expect(summarizeTree(buildSubagentTree(agents))).toStrictEqual([
			{
				kind: "agent",
				id: "agent-parent",
				children: [{kind: "agent", id: "agent-child", children: []}],
			},
		]);
	});

	it("handles deep nesting", () => {
		const agents = [
			makeAgent({
				id: "agent-root",
				startedAt: "1999-12-31T00:00:00.000Z",
				finishedAt: "1999-12-31T00:01:00.000Z",
			}),
			makeAgent({
				id: "agent-middle",
				parentAgentId: "agent-root",
				startedAt: "1999-12-31T00:00:10.000Z",
				finishedAt: "1999-12-31T00:00:40.000Z",
			}),
			makeAgent({
				id: "agent-deep",
				parentAgentId: "agent-middle",
				startedAt: "1999-12-31T00:00:15.000Z",
				finishedAt: "1999-12-31T00:00:25.000Z",
			}),
		];

		expect(summarizeTree(buildSubagentTree(agents))).toStrictEqual([
			{
				kind: "agent",
				id: "agent-root",
				children: [
					{
						kind: "agent",
						id: "agent-middle",
						children: [{kind: "agent", id: "agent-deep", children: []}],
					},
				],
			},
		]);
	});

	it("returns no entries for no agents", () => {
		expect(buildSubagentTree([])).toStrictEqual([]);
	});
});

function workflowAgent(
	id: string,
	runId: string,
	phase: {title?: string; index?: number},
	startedAt: string,
	finishedAt: string | null = null,
): Subagent {
	return makeAgent({
		id,
		agentType: "workflow-subagent",
		workflowRunId: runId,
		workflowPhase: phase.title ?? null,
		workflowPhaseIndex: phase.index ?? null,
		startedAt,
		finishedAt,
	});
}

describe("buildSubagentTree workflow runs", () => {
	it("groups workflow agents by run and phase, outside the parallel heuristic", () => {
		const agents = [
			workflowAgent("agent-b2", "wf_b", {title: "Review", index: 2}, "1999-12-31T00:01:01.000Z"),
			workflowAgent("agent-a1", "wf_a", {title: "Draft", index: 1}, "1999-12-31T00:00:01.000Z"),
			workflowAgent("agent-a2", "wf_a", {title: "Draft", index: 1}, "1999-12-31T00:00:01.500Z"),
			workflowAgent("agent-a3", "wf_a", {title: "Review", index: 2}, "1999-12-31T00:00:30.000Z"),
			workflowAgent("agent-b1", "wf_b", {title: "Draft", index: 1}, "1999-12-31T00:01:00.000Z"),
			makeAgent({id: "agent-tool", startedAt: "1999-12-31T00:00:00.500Z"}),
		];

		expect(
			summarizeTree(buildSubagentTree(agents, {workflowRuns: [{runId: "wf_a", workflowName: "poems"}]})),
		).toStrictEqual([
			{kind: "agent", id: "agent-tool", children: []},
			{
				kind: "run",
				runId: "wf_a",
				name: "poems",
				phases: [
					{
						title: "Draft",
						agents: [
							{kind: "agent", id: "agent-a1", children: []},
							{kind: "agent", id: "agent-a2", children: []},
						],
					},
					{title: "Review", agents: [{kind: "agent", id: "agent-a3", children: []}]},
				],
			},
			{
				kind: "run",
				runId: "wf_b",
				name: "wf_b",
				phases: [
					{title: "Draft", agents: [{kind: "agent", id: "agent-b1", children: []}]},
					{title: "Review", agents: [{kind: "agent", id: "agent-b2", children: []}]},
				],
			},
		]);
	});

	it('titles the unphased bucket "Agents" when alone and "Other agents" beside phases', () => {
		const alone = buildSubagentTree([workflowAgent("agent-x", "wf_a", {}, "1999-12-31T00:00:00.000Z")]);
		const mixed = buildSubagentTree([
			workflowAgent("agent-x", "wf_a", {}, "1999-12-31T00:00:00.000Z"),
			workflowAgent("agent-y", "wf_a", {title: "Draft", index: 1}, "1999-12-31T00:00:05.000Z"),
		]);

		expect(summarizeTree(alone)).toStrictEqual([
			{
				kind: "run",
				runId: "wf_a",
				name: "wf_a",
				phases: [{title: "Agents", agents: [{kind: "agent", id: "agent-x", children: []}]}],
			},
		]);
		expect(summarizeTree(mixed)).toStrictEqual([
			{
				kind: "run",
				runId: "wf_a",
				name: "wf_a",
				phases: [
					{title: "Draft", agents: [{kind: "agent", id: "agent-y", children: []}]},
					{title: "Other agents", agents: [{kind: "agent", id: "agent-x", children: []}]},
				],
			},
		]);
	});

	it('names an untitled phase by its index, "Phase 3"', () => {
		const tree = buildSubagentTree([workflowAgent("agent-x", "wf_a", {index: 3}, "1999-12-31T00:00:00.000Z")]);

		expect(summarizeTree(tree)).toStrictEqual([
			{
				kind: "run",
				runId: "wf_a",
				name: "wf_a",
				phases: [{title: "Phase 3", agents: [{kind: "agent", id: "agent-x", children: []}]}],
			},
		]);
	});

	it("counts each phase's agents, settles a finished run, and spans its duration", () => {
		const [run] = buildSubagentTree(
			[
				workflowAgent(
					"agent-a1",
					"wf_a",
					{title: "Draft", index: 1},
					"1999-12-31T00:00:00.000Z",
					"1999-12-31T00:00:10.000Z",
				),
				workflowAgent(
					"agent-a2",
					"wf_a",
					{title: "Draft", index: 1},
					"1999-12-31T00:00:01.000Z",
					"1999-12-31T00:00:40.000Z",
				),
			],
			{workflowRuns: [{runId: "wf_a", workflowName: "poems", status: "completed"}]},
		);

		expect(
			run !== undefined && "type" in run && run.type === "workflow-run"
				? {
						startedAt: run.startedAt,
						durationMs: run.durationMs,
						agentCount: run.agentCount,
						settled: run.settled,
						phases: run.phases.map(({index, title, counts, status}) => ({index, title, counts, status})),
					}
				: run,
		).toStrictEqual({
			startedAt: "1999-12-31T00:00:00.000Z",
			durationMs: 40_000,
			agentCount: 2,
			settled: true,
			phases: [
				{
					index: 1,
					title: "Draft",
					counts: {done: 2, running: 0, stalled: 0, error: 0, stopped: 0, pending: 0, total: 2},
					status: "done",
				},
			],
		});
	});

	it("sets superseded attempts apart from the phase's agents and counts, and counts a failed agent as an error", () => {
		const [run] = buildSubagentTree(
			[
				{
					...workflowAgent(
						"agent-a1",
						"wf_a",
						{title: "Draft", index: 1},
						"1999-12-31T00:00:00.000Z",
						"1999-12-31T00:00:10.000Z",
					),
					workflowState: "done",
					workflowAttempt: "final",
				},
				{
					...workflowAgent(
						"agent-a2",
						"wf_a",
						{title: "Draft", index: 1},
						"1999-12-31T00:00:01.000Z",
						"1999-12-31T00:00:20.000Z",
					),
					workflowState: "failed",
					workflowAttempt: "final",
				},
				{
					...workflowAgent("agent-a3", "wf_a", {title: "Draft", index: 1}, "1999-12-31T00:00:02.000Z"),
					workflowState: "ended",
					workflowAttempt: "superseded",
				},
			],
			{workflowRuns: [{runId: "wf_a", workflowName: "poems", status: "completed"}]},
		);

		expect(
			run !== undefined && "type" in run && run.type === "workflow-run"
				? {
						agentCount: run.agentCount,
						phases: run.phases.map(({title, counts, status, agents, supersededAgents}) => ({
							title,
							counts,
							status,
							agents: agents.map((node) => node.agent.id),
							supersededAgents: supersededAgents.map((node) => node.agent.id),
						})),
					}
				: run,
		).toStrictEqual({
			agentCount: 2,
			phases: [
				{
					title: "Draft",
					counts: {done: 1, running: 0, stalled: 0, error: 1, stopped: 0, pending: 0, total: 2},
					status: "error",
					agents: ["agent-a1", "agent-a2"],
					supersededAgents: ["agent-a3"],
				},
			],
		});
	});
});

describe("phaseAriaLabel", () => {
	it("reads upstream's phase row label", () => {
		const counts = {done: 1, running: 1, stalled: 0, error: 0, stopped: 0, pending: 0, total: 2};
		expect(phaseAriaLabel({index: 1, title: "Draft", counts, status: "running"})).toBe(
			"Phase: Draft, Running, 1 of 2 agents done",
		);
		expect(
			phaseAriaLabel({
				index: 2,
				title: "Review",
				counts: {...counts, done: 1, running: 0, total: 1},
				status: "done",
			}),
		).toBe("Phase: Review, Done, 1 of 1 agent done");
	});
});

describe("groupSubagentTreeByDate", () => {
	it("groups chronological entries under local date labels without changing their order", () => {
		const tree = buildSubagentTree([
			makeAgent({
				id: "agent-yesterday-morning",
				startedAt: "2026-08-05T09:00:00-04:00",
				finishedAt: "2026-08-05T09:01:00-04:00",
			}),
			makeAgent({
				id: "agent-yesterday-evening",
				startedAt: "2026-08-05T18:00:00-04:00",
				finishedAt: "2026-08-05T18:01:00-04:00",
			}),
			makeAgent({
				id: "agent-today",
				startedAt: "2026-08-06T10:00:00-04:00",
				finishedAt: "2026-08-06T10:01:00-04:00",
			}),
		]);

		const groups = groupSubagentTreeByDate(tree, new Date("2026-08-06T12:00:00-04:00"));

		expect(
			groups.map((group) => ({
				label: group.label,
				entries: summarizeTree(group.entries),
			})),
		).toStrictEqual([
			{
				label: "Yesterday",
				entries: [
					{kind: "agent", id: "agent-yesterday-morning", children: []},
					{kind: "agent", id: "agent-yesterday-evening", children: []},
				],
			},
			{
				label: "Today",
				entries: [{kind: "agent", id: "agent-today", children: []}],
			},
		]);
	});

	it("uses calendar dates for older entries and keeps missing timestamps visible", () => {
		const tree = buildSubagentTree([
			makeAgent({
				id: "agent-older",
				startedAt: "2026-07-31T10:00:00-04:00",
				finishedAt: "2026-07-31T10:01:00-04:00",
			}),
			makeAgent({id: "agent-unknown"}),
		]);

		const groups = groupSubagentTreeByDate(tree, new Date("2026-08-06T12:00:00-04:00"));

		expect(
			groups.map((group) => ({
				label: group.label,
				entries: summarizeTree(group.entries),
			})),
		).toStrictEqual([
			{
				label: "July 31, 2026",
				entries: [{kind: "agent", id: "agent-older", children: []}],
			},
			{
				label: "Unknown date",
				entries: [{kind: "agent", id: "agent-unknown", children: []}],
			},
		]);
	});
});

describe("DB-backed subagents", () => {
	let db: AppDb;

	beforeEach(() => {
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
	});

	it("preserves parent and active fields in the client shape", () => {
		db.index
			.insert(schema.subagents)
			.values({
				id: "agent-child",
				sessionId: "session-test",
				projectId: "project-test",
				parentAgentId: "agent-parent",
				agentType: "Explore",
				attributionAgent: "markdown-tasks:do-task",
				slug: "explore-test",
				description: "Inspect test files",
				startedAt: "1999-12-31T00:00:05.000Z",
				finishedAt: null,
				filePath: "/tmp/test/agent-child.jsonl",
				mtimeMs: 1_000,
			})
			.run();

		const agents = getSubagentsForSession(db.index, "session-test").map(toClientSubagent);
		expect(agents).toStrictEqual([
			{
				id: "agent-child",
				sessionId: "session-test",
				projectId: "project-test",
				parentAgentId: "agent-parent",
				agentType: "Explore",
				attributionAgent: "markdown-tasks:do-task",
				slug: "explore-test",
				description: "Inspect test files",
				model: null,
				startedAt: "1999-12-31T00:00:05.000Z",
				finishedAt: null,
			},
		]);
	});

	it("carries a workflow agent's run id, phase and phase index", () => {
		db.index
			.insert(schema.subagents)
			.values({
				id: "agent-aw1",
				sessionId: "session-test",
				projectId: "project-test",
				agentType: "workflow-subagent",
				description: "diff:a",
				workflowRunId: "wf_x-1",
				workflowPhase: "Diff",
				workflowPhaseIndex: 2,
				filePath: "/tmp/test/subagents/workflows/wf_x-1/agent-aw1.jsonl",
				mtimeMs: 1_000,
			})
			.run();

		const agents = getSubagentsForSession(db.index, "session-test").map(toClientSubagent);
		expect(agents).toStrictEqual([
			{
				id: "agent-aw1",
				sessionId: "session-test",
				projectId: "project-test",
				parentAgentId: null,
				agentType: "workflow-subagent",
				attributionAgent: null,
				slug: null,
				description: "diff:a",
				model: null,
				startedAt: null,
				finishedAt: null,
				workflowRunId: "wf_x-1",
				workflowPhase: "Diff",
				workflowPhaseIndex: 2,
			},
		]);
	});

	it("carries the slow command finish times only when the agent ran one", () => {
		const row = {
			sessionId: "session-test",
			projectId: "project-test",
			startedAt: "1999-12-31T00:00:05.000Z",
			mtimeMs: 1_000,
		};
		db.index
			.insert(schema.subagents)
			.values([
				{
					...row,
					id: "agent-slow",
					filePath: "/tmp/a.jsonl",
					slowCommandsJson:
						'[{"finishedAt":"1999-12-31T00:00:09.000Z","description":"Run tests","status":"completed"}]',
				},
				{...row, id: "agent-quick", filePath: "/tmp/b.jsonl"},
			])
			.run();

		const agents = getSubagentsForSession(db.index, "session-test").map(toClientSubagent);
		expect(agents.map(({id, slowCommands}) => ({id, slowCommands}))).toStrictEqual([
			{
				id: "agent-slow",
				slowCommands: [{finishedAt: "1999-12-31T00:00:09.000Z", description: "Run tests", status: "completed"}],
			},
			{id: "agent-quick", slowCommands: undefined},
		]);
		expect(Object.hasOwn(agents[1]!, "slowCommands")).toBe(false);
	});
});

describe("extractPendingSubagents", () => {
	it("returns Agent calls that do not have a tool result", () => {
		const records = [
			{
				sessionId: "session-test",
				timestamp: "1999-12-31T00:00:00.000Z",
				message: {
					content: [
						{
							type: "tool_use",
							id: "tool-finished",
							name: "Agent",
							input: {
								subagent_type: "Explore",
								description: "Finished exploration",
							},
						},
						{
							type: "tool_use",
							id: "tool-active",
							name: "Agent",
							input: {
								subagent_type: "general-purpose",
								description: "Active implementation",
							},
						},
					],
				},
			},
			{
				sessionId: "session-test",
				timestamp: "1999-12-31T00:01:00.000Z",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-finished",
							content: "agentId: finished-agent",
						},
					],
				},
			},
		];

		expect(extractPendingSubagents(records)).toStrictEqual([
			{
				key: "tool-active",
				sessionId: "session-test",
				agentType: "general-purpose",
				agentId: "",
				description: "Active implementation",
			},
		]);
	});
});
