import {describe, expect, it} from "vite-plus/test";
import type {WorkflowAgentEntry, WorkflowProgressEntry} from "../src/lib/workflow-progress";
import type {WorkflowRun} from "../src/lib/workflow-runs";
import
{
	agentCounts,
	clampWorkflowName,
	pickSizeWarning,
	ratchetWarning,
	sizeAxis,
	sizeTokenLabel,
	sizeWarning,
	type SizeWarning,
	type SizeWarningStore,
} from "../src/lib/workflow-size-warning";

function agent(index: number, fields: Partial<WorkflowAgentEntry> = {}): WorkflowAgentEntry
{
	return {
		type: "workflow_agent",
		index,
		label: `agent ${index}`,
		state: "progress",
		startedAt: 1_790_000_000_000,
		...fields,
	};
}

function agents(count: number, fields: Partial<WorkflowAgentEntry> = {}): WorkflowAgentEntry[]
{
	return Array.from(
		{
			length: count,
		},
		(_, i) => agent(i + 1, fields),
	);
}

function run(taskId: string, progress: WorkflowProgressEntry[], fields: Partial<WorkflowRun> = {}): WorkflowRun
{
	return {
		runId: `wf_${taskId}`,
		taskId,
		toolUseId: `toolu_${taskId}`,
		toolUseIds: [`toolu_${taskId}`],
		workflowName: "upstream-sync",
		scriptPath: "",
		transcriptDir: "",
		description: "",
		status: "running",
		summary: null,
		startedAt: null,
		durationMs: null,
		totalTokens: null,
		progress,
		...fields,
	};
}

describe("agentCounts", () =>
{
	it("counts every agent as scheduled and only started ones as started, like upstream _Se", () =>
	{
		expect(
			agentCounts([
				{
					type: "workflow_phase",
					index: 1,
					title: "P",
				},
				agent(
					1,
					{
						state: "done",
						startedAt: undefined,
					},
				),
				agent(
					2,
					{
						state: "error",
						startedAt: undefined,
					},
				),
				agent(
					3,
					{
						state: "start",
					},
				),
				agent(
					4,
					{
						state: "start",
						startedAt: undefined,
						tokens: 10,
					},
				),
				agent(
					5,
					{
						state: "start",
						startedAt: undefined,
						queuedAt: 1,
					},
				),
			]),
		).toStrictEqual(
			{
				scheduledAgents: 5,
				startedAgents: 4,
			},
		);
	});

	it("sees every agent of a live local run as started, since queued agents are never on disk", () =>
	{
		expect(agentCounts(agents(3))).toStrictEqual(
			{
				scheduledAgents: 3,
				startedAgents: 3,
			},
		);
		// So the projection is the measured per-agent average, never the 70k default.
		expect(
			sizeWarning(
				{
					scheduledAgents: 30,
					startedAgents: 30,
					totalTokens: 300_000,
				},
			),
		).toStrictEqual<SizeWarning>(
			{
				axis: "agents",
				scheduledAgents: 30,
				totalTokens: 300_000,
				projectedTokens: 300_000,
			},
		);
	});
});

describe("sizeAxis", () =>
{
	it("trips on more than 25 agents or more than 1.5M tokens", () =>
	{
		expect([
			sizeAxis(25, 1_500_000),
			sizeAxis(26, 0),
			sizeAxis(0, 1_500_001),
			sizeAxis(26, 1_500_001),
		]).toStrictEqual([undefined, "agents", "tokens", "both"]);
	});
});

describe("sizeWarning", () =>
{
	it("warns on 26 started agents with no tokens, projecting zero", () =>
	{
		expect(
			sizeWarning(
				{
					scheduledAgents: 26,
					startedAgents: 26,
					totalTokens: 0,
				},
			),
		).toStrictEqual<SizeWarning>(
			{
				axis: "agents",
				scheduledAgents: 26,
				totalTokens: 0,
				projectedTokens: 0,
			},
		);
	});

	it("does not warn at 25 agents", () =>
	{
		expect(
			sizeWarning(
				{
					scheduledAgents: 25,
					startedAgents: 25,
					totalTokens: 0,
				},
			),
		).toBeUndefined();
	});

	it("projects the per-agent average across scheduled agents", () =>
	{
		expect(
			sizeWarning(
				{
					scheduledAgents: 10,
					startedAgents: 2,
					totalTokens: 400_000,
				},
			),
		).toStrictEqual<SizeWarning>(
			{
				axis: "tokens",
				scheduledAgents: 10,
				totalTokens: 400_000,
				projectedTokens: 2_000_000,
			},
		);
	});

	it("projects 70k per agent when none has started", () =>
	{
		expect(
			sizeWarning(
				{
					scheduledAgents: 22,
					startedAgents: 0,
					totalTokens: 0,
				},
			),
		).toStrictEqual<SizeWarning>(
			{
				axis: "tokens",
				scheduledAgents: 22,
				totalTokens: 0,
				projectedTokens: 1_540_000,
			},
		);
	});

	it("warns on both axes", () =>
	{
		expect(
			sizeWarning(
				{
					scheduledAgents: 30,
					startedAgents: 30,
					totalTokens: 2_000_000,
				},
			),
		).toStrictEqual<SizeWarning>(
			{
				axis: "both",
				scheduledAgents: 30,
				totalTokens: 2_000_000,
				projectedTokens: 2_000_000,
			},
		);
	});
});

describe("ratchetWarning", () =>
{
	const prev: SizeWarning =
	{
		axis: "agents",
		scheduledAgents: 40,
		totalTokens: 0,
		projectedTokens: 0,
	};

	it("keeps the previous object when it already holds both maxima", () =>
	{
		expect(
			ratchetWarning(
				{
					axis: "agents",
					scheduledAgents: 30,
					totalTokens: 0,
					projectedTokens: 0,
				},
				prev,
			),
		).toBe(prev);
	});

	it("takes the max of each count and recomputes the axis", () =>
	{
		expect(
			ratchetWarning(
				{
					axis: "tokens",
					scheduledAgents: 20,
					totalTokens: 1_600_000,
					projectedTokens: 1_600_000,
				},
				prev,
			),
		).toStrictEqual<SizeWarning>(
			{
				axis: "both",
				scheduledAgents: 40,
				totalTokens: 1_600_000,
				projectedTokens: 1_600_000,
			},
		);
	});

	it("returns the fresh warning when nothing is stored", () =>
	{
		expect(ratchetWarning(prev, undefined)).toBe(prev);
	});
});

describe("pickSizeWarning", () =>
{
	it("picks the first running, undismissed run with a warning", () =>
	{
		const store: SizeWarningStore = new Map([["t1", "dismissed"]]);
		expect(
			pickSizeWarning(
				[
					run(
						"t0",
						agents(30),
						{
							status: "completed",
						},
					),
					run("t1", agents(30)),
					run("t2", agents(5)),
					run("t3", agents(27)),
					run("t4", agents(40)),
				],
				store,
			),
		).toStrictEqual(
			{
				taskId: "t3",
				name: "upstream-sync",
				warning:
				{
					axis: "agents",
					scheduledAgents: 27,
					totalTokens: 0,
					projectedTokens: 0,
				},
			},
		);
	});

	it("keeps a stored warning after the counts drop below the caps", () =>
	{
		const stored: SizeWarning =
		{
			axis: "agents",
			scheduledAgents: 40,
			totalTokens: 0,
			projectedTokens: 0,
		};
		expect(
			pickSizeWarning(
				[run("t1", agents(3))],
				new Map([
					[
						"t1",
						{
							warning: stored,
						},
					],
				]),
			)?.warning,
		).toBe(stored);
	});

	it("prefers the run's own totalTokens and falls back to the description for its name", () =>
	{
		expect(
			pickSizeWarning(
				[
					run(
						"t1",
						agents(2),
						{
							workflowName: "",
							description: "Parity sweep",
							totalTokens: 2_000_000,
						},
					),
				],
				new Map(),
			),
		).toStrictEqual(
			{
				taskId: "t1",
				name: "Parity sweep",
				warning:
				{
					axis: "tokens",
					scheduledAgents: 2,
					totalTokens: 2_000_000,
					projectedTokens: 2_000_000,
				},
			},
		);
	});

	it("names nothing for a run with neither name nor description", () =>
	{
		expect(
			pickSizeWarning(
				[
					run(
						"t1",
						agents(26),
						{
							workflowName: "",
						},
					),
				],
				new Map(),
			)?.name,
		).toBeNull();
	});
});

describe("sizeTokenLabel", () =>
{
	it("formats compact with one fraction digit", () =>
	{
		expect([sizeTokenLabel(15_274_469, "en"), sizeTokenLabel(1_600_000, "en")]).toStrictEqual(["15.3M", "1.6M"]);
	});
});

describe("clampWorkflowName", () =>
{
	it("clamps to 64 code points plus an ellipsis", () =>
	{
		expect(clampWorkflowName("a".repeat(63) + " " + "b".repeat(6))).toBe("a".repeat(63) + "…");
		expect(clampWorkflowName("😀".repeat(70))).toBe("😀".repeat(64) + "…");
		expect(clampWorkflowName("short")).toBe("short");
	});
});
