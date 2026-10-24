import {readFileSync, readdirSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {
	type WorkflowAgentEntry,
	type WorkflowProgressCounts,
	type WorkflowProgressEntry,
	UNPHASED_INDEX,
	WorkflowProgressEntrySchema,
	RuntimeWorkflowProgressEntrySchema,
	agentState,
	buildWorkflowProgress,
	cellCap,
	cellStates,
	endUnfinishedAgents,
	phaseStatus,
	progressSummary,
	pulseVars,
	workflowSummary,
} from "../src/lib/workflow-progress";

function agent(fields: Partial<WorkflowAgentEntry> & Pick<WorkflowAgentEntry, "index" | "state">): WorkflowAgentEntry {
	return {type: "workflow_agent", label: `agent-${fields.index}`, agentId: `a${fields.index}`, ...fields};
}

const zero: WorkflowProgressCounts = {done: 0, running: 0, stalled: 0, error: 0, stopped: 0, pending: 0, total: 0};

describe("agentState", () => {
	const now = 1_000_000;
	it.each([
		["done", agent({index: 0, state: "done"}), {}, "done"],
		["error", agent({index: 0, state: "error"}), {}, "error"],
		[
			"progress with recent progress",
			agent({index: 0, state: "progress", lastProgressAt: now - 1}),
			{now},
			"running",
		],
		["progress without a clock", agent({index: 0, state: "progress", lastProgressAt: 0}), {}, "running"],
		[
			"progress at exactly 90s",
			agent({index: 0, state: "progress", lastProgressAt: now - 90_000}),
			{now},
			"running",
		],
		["progress past 90s", agent({index: 0, state: "progress", lastProgressAt: now - 90_001}), {now}, "stalled"],
		[
			"custom stallMs",
			agent({index: 0, state: "progress", lastProgressAt: now - 11}),
			{now, stallMs: 10},
			"stalled",
		],
		["start with startedAt", agent({index: 0, state: "start", startedAt: 5}), {}, "running"],
		["start without startedAt", agent({index: 0, state: "start"}), {}, "pending"],
		["stopped task, unfinished", agent({index: 0, state: "progress"}), {taskStopped: true}, "stopped"],
		["stopped task, errored", agent({index: 0, state: "progress", error: "boom"}), {taskStopped: true}, "error"],
		["stopped task, done", agent({index: 0, state: "done"}), {taskStopped: true}, "done"],
	] as const)("%s", (_name, entry, options, expected) => {
		expect(agentState(entry, options)).toBe(expected);
	});
});

describe("phaseStatus", () => {
	it.each([
		[{...zero, error: 1, running: 1, total: 2}, false, "error"],
		[{...zero, running: 1, total: 1}, false, "running"],
		[{...zero, running: 1, total: 1}, true, "done"],
		[zero, false, "pending"],
		[zero, true, "notRun"],
		[{...zero, pending: 2, total: 2}, true, "notRun"],
		[{...zero, done: 2, total: 2}, false, "done"],
		[{...zero, done: 1, pending: 1, total: 2}, false, "running"],
		[{...zero, done: 1, stopped: 1, total: 2}, true, "done"],
	] as const)("%o settled=%s → %s", (counts, settled, expected) => {
		expect(phaseStatus(counts, settled)).toBe(expected);
	});
});

describe("buildWorkflowProgress", () => {
	it("returns undefined for no entries", () => {
		expect(buildWorkflowProgress(undefined)).toBeUndefined();
		expect(buildWorkflowProgress([])).toBeUndefined();
	});

	it("titles unphased agents 'Agents' when they are the only phase", () => {
		const progress = buildWorkflowProgress([agent({index: 0, state: "done", tokens: 10, durationMs: 4})]);
		expect(progress).toStrictEqual({
			counts: {...zero, done: 1, total: 1},
			totalTokens: 10,
			phases: [
				{
					index: UNPHASED_INDEX,
					title: "Agents",
					agents: [agent({index: 0, state: "done", tokens: 10, durationMs: 4})],
					counts: {...zero, done: 1, total: 1},
					status: "done",
					totalTokens: 10,
					maxDurationMs: 4,
				},
			],
		});
	});

	it("titles unphased agents 'Other agents' beside other phases, untitled phases 'Phase N', and sorts by index", () => {
		const entries: WorkflowProgressEntry[] = [
			agent({index: 0, state: "done"}),
			{type: "workflow_phase", index: 2, title: "Review"},
			agent({index: 1, state: "progress", phaseIndex: 1}),
			agent({index: 2, state: "progress", phaseIndex: 3, phaseTitle: "Late title"}),
		];
		const progress = buildWorkflowProgress(entries);
		expect(
			progress?.phases.map(({index, title, status, counts, totalTokens, maxDurationMs}) => ({
				index,
				title,
				status,
				counts,
				totalTokens,
				maxDurationMs,
			})),
		).toStrictEqual([
			{
				index: 1,
				title: "Phase 2",
				status: "running",
				counts: {...zero, running: 1, total: 1},
				totalTokens: 0,
				maxDurationMs: undefined,
			},
			{
				index: 2,
				title: "Review",
				status: "pending",
				counts: zero,
				totalTokens: 0,
				maxDurationMs: undefined,
			},
			{
				index: 3,
				title: "Late title",
				status: "running",
				counts: {...zero, running: 1, total: 1},
				totalTokens: 0,
				maxDurationMs: undefined,
			},
			{
				index: UNPHASED_INDEX,
				title: "Other agents",
				status: "done",
				counts: {...zero, done: 1, total: 1},
				totalTokens: 0,
				maxDurationMs: undefined,
			},
		]);
	});

	it("replaces a placeholder 'Phase N' title once a real title arrives, but keeps a real one", () => {
		const progress = buildWorkflowProgress([
			agent({index: 0, state: "done", phaseIndex: 0}),
			agent({index: 1, state: "done", phaseIndex: 0, phaseTitle: "Scan"}),
			agent({index: 2, state: "done", phaseIndex: 0, phaseTitle: "Ignored"}),
		]);
		expect(progress?.phases.map((phase) => phase.title)).toStrictEqual(["Scan"]);
	});

	it("counts stalled agents as running too and marks settled running phases done", () => {
		const now = 200_000;
		const entries = [
			agent({index: 0, state: "progress", phaseIndex: 0, lastProgressAt: now - 100_000}),
			agent({index: 1, state: "progress", phaseIndex: 0, lastProgressAt: now}),
		];
		expect(buildWorkflowProgress(entries, {now})?.counts).toStrictEqual({
			...zero,
			running: 2,
			stalled: 1,
			total: 2,
		});
		expect(buildWorkflowProgress(entries, {now, settled: true})?.phases[0]?.status).toBe("done");
	});

	it("groups the real wf_b3195248-105 run into its 4 phases and 182 agents", () => {
		const fixture = JSON.parse(
			readFileSync(join(import.meta.dirname, "fixtures", "workflow-progress-wf_b3195248-105.json"), "utf8"),
		) as {workflowProgress: unknown[]};
		const entries = fixture.workflowProgress.map((entry) => WorkflowProgressEntrySchema.parse(entry));
		const progress = buildWorkflowProgress(entries, {settled: true});
		expect({
			counts: progress?.counts,
			totalTokens: progress?.totalTokens,
			phases: progress?.phases.map(({index, title, status, counts, totalTokens, maxDurationMs, agents}) => ({
				index,
				title,
				status,
				counts,
				totalTokens,
				maxDurationMs,
				agents: agents.length,
			})),
		}).toStrictEqual({
			counts: {...zero, done: 182, total: 182},
			totalTokens: 10_209_286,
			phases: [
				{
					index: 1,
					title: "Broad",
					status: "done",
					counts: {...zero, done: 2, total: 2},
					totalTokens: 0,
					maxDurationMs: undefined,
					agents: 2,
				},
				{
					index: 2,
					title: "Investigate",
					status: "done",
					counts: {...zero, done: 178, total: 178},
					totalTokens: 10_082_898,
					maxDurationMs: 1_284_894,
					agents: 178,
				},
				{
					index: 3,
					title: "Critic",
					status: "done",
					counts: {...zero, done: 1, total: 1},
					totalTokens: 76_427,
					maxDurationMs: 83_040,
					agents: 1,
				},
				{
					index: 4,
					title: "Synthesize",
					status: "done",
					counts: {...zero, done: 1, total: 1},
					totalTokens: 49_961,
					maxDurationMs: 26_254,
					agents: 1,
				},
			],
		});
	});
});

describe("endUnfinishedAgents", () => {
	const phase: WorkflowProgressEntry = {type: "workflow_phase", index: 0, title: "P"};

	it("returns the same array when nothing is unfinished", () => {
		const entries = [phase, agent({index: 0, state: "done"}), agent({index: 1, state: "start"})];
		expect(endUnfinishedAgents(entries, "completed")).toBe(entries);
	});

	it("fails running agents and started agents with tokens when the run ended", () => {
		const entries = [
			phase,
			agent({index: 0, state: "progress"}),
			agent({index: 1, state: "start", tokens: 3}),
			agent({index: 2, state: "error", error: "own"}),
			agent({index: 3, state: "progress", error: "kept"}),
		];
		expect(endUnfinishedAgents(entries, "failed")).toStrictEqual([
			phase,
			agent({index: 0, state: "error", error: "Workflow ended before completion"}),
			agent({index: 1, state: "error", tokens: 3, error: "Workflow ended before completion"}),
			agent({index: 2, state: "error", error: "own"}),
			agent({index: 3, state: "error", error: "kept"}),
		]);
	});

	it("leaves the error empty when the run was stopped", () => {
		expect(endUnfinishedAgents([agent({index: 0, state: "progress"})], "stopped")).toStrictEqual([
			agent({index: 0, state: "error"}),
		]);
	});
});

describe("cellCap", () => {
	it("is 35 per row when wrapping (4 rows by default), 36 otherwise, unbounded with fixed columns", () => {
		expect(cellCap({wrap: true})).toBe(140);
		expect(cellCap({wrap: true, maxRows: 8})).toBe(280);
		expect(cellCap({})).toBe(36);
		expect(cellCap({cols: 16})).toBe(2 ** 53 - 1);
	});
});

describe("cellStates", () => {
	it("lists one cell per agent in state order when under the cap, splitting stalled out of running", () => {
		expect(
			cellStates({done: 1, running: 3, stalled: 1, error: 1, stopped: 1, pending: 2, total: 8}, 36),
		).toStrictEqual(["done", "running", "running", "stalled", "error", "stopped", "pending", "pending"]);
	});

	it("samples 300 agents into exactly 280 cells, keeping at least one per non-zero state", () => {
		const counts = {done: 290, running: 5, stalled: 2, error: 1, stopped: 0, pending: 4, total: 300};
		const cells = cellStates(counts, 280);
		expect(cells).toHaveLength(280);
		const tally = Object.fromEntries(
			["done", "running", "stalled", "error", "stopped", "pending"].map((state) => [
				state,
				cells.filter((cell) => cell === state).length,
			]),
		);
		// Over the cap, stalled agents are folded into running (upstream Dme).
		expect(tally).toStrictEqual({done: 268, running: 5, stalled: 0, error: 2, stopped: 0, pending: 5});
	});
});

describe("progressSummary", () => {
	it.each([
		[zero, "Waiting for agents to start"],
		[{...zero, done: 1, running: 2, total: 3}, "1 of 3 agents done, 2 running, 0 stalled, 0 failed"],
		[
			{...zero, done: 0, running: 3, stalled: 1, error: 1, total: 4},
			"0 of 4 agents done, 2 running, 1 stalled, 1 failed",
		],
		[{...zero, stopped: 1, total: 1}, "0 of 1 agent done, 1 stopped, 0 failed"],
		[{...zero, done: 2, stopped: 1, error: 1, total: 4}, "2 of 4 agents done, 1 stopped, 1 failed"],
	] as const)("%o → %s", (counts, expected) => {
		expect(progressSummary(counts)).toBe(expected);
	});
});

describe("pulseVars", () => {
	it("matches the values measured live on upstream", () => {
		expect(pulseVars(0)).toStrictEqual({"--epitaxy-pulse-dur": "2.40s", "--epitaxy-pulse-delay": "0.00s"});
		expect(pulseVars(1)).toStrictEqual({"--epitaxy-pulse-dur": "3.46s", "--epitaxy-pulse-delay": "-2.14s"});
		expect(pulseVars(2)).toStrictEqual({"--epitaxy-pulse-dur": "3.11s", "--epitaxy-pulse-delay": "-0.74s"});
	});
});

describe("workflowSummary", () => {
	it.each([
		[undefined, undefined, undefined],
		["same", "same", undefined],
		['Workflow "wf" completed', undefined, undefined],
		['Workflow "wf" failed: agent crashed', undefined, "Agent crashed"],
		['Dynamic workflow "wf" was killed: by user.', undefined, "By user."],
		['Workflow "wf" stopped', "desc", undefined],
		["plain summary", undefined, "Plain summary"],
	] as const)("%s (description %s) → %s", (summary, description, expected) => {
		expect(workflowSummary(summary, description)).toBe(expected);
	});
});

describe("WorkflowProgressEntrySchema", () => {
	it("rejects unknown keys in the strict form and strips them in the runtime form", () => {
		const entry = {type: "workflow_phase", index: 1, title: "P", futureKey: 1};
		expect(WorkflowProgressEntrySchema.safeParse(entry).success).toBe(false);
		expect(RuntimeWorkflowProgressEntrySchema.parse(entry)).toStrictEqual({
			type: "workflow_phase",
			index: 1,
			title: "P",
		});
	});

	it("validates every workflowProgress entry on disk", () => {
		const projectsDir = join(homedir(), ".claude", "projects");
		let projects: string[];
		try {
			projects = readdirSync(projectsDir);
		} catch {
			return;
		}
		const failures: string[] = [];
		for (const project of projects) {
			let sessions: string[];
			try {
				sessions = readdirSync(join(projectsDir, project));
			} catch {
				continue;
			}
			for (const session of sessions) {
				const dir = join(projectsDir, project, session, "workflows");
				let files: string[];
				try {
					files = readdirSync(dir).filter((file) => file.endsWith(".json"));
				} catch {
					continue;
				}
				for (const file of files) {
					const run = JSON.parse(readFileSync(join(dir, file), "utf8")) as {workflowProgress?: unknown};
					if (!Array.isArray(run.workflowProgress)) continue;
					for (const [index, entry] of run.workflowProgress.entries()) {
						const result = WorkflowProgressEntrySchema.safeParse(entry);
						if (!result.success) failures.push(`${dir}/${file}[${index}]: ${result.error.message}`);
					}
				}
			}
		}
		expect(failures).toStrictEqual([]);
	});
});
