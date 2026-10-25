// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {BackgroundTasksList} from "../src/components/panes/background-tasks-pane";
import {WorkflowTaskCard} from "../src/components/panes/workflow-task-card";
import type {SessionWorkflowRun} from "../src/lib/api/session-workflow-runs";
import type {BackgroundTask} from "../src/lib/background-tasks";
import type {WorkflowProgressEntry} from "../src/lib/workflow-progress";

const NOW = Date.parse("2026-10-19T12:00:07.000Z");
const STARTED_AT = Date.parse("2026-10-19T12:00:00.000Z");

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask {
	return {
		toolUseId: null,
		kind: "workflow",
		description: "",
		command: null,
		status: "running",
		output: null,
		summary: null,
		outputFile: null,
		startedAt: null,
		...overrides,
	};
}

function run(overrides: Partial<SessionWorkflowRun> & Pick<SessionWorkflowRun, "taskId">): SessionWorkflowRun {
	return {
		runId: `wf_${overrides.taskId}`,
		toolUseId: `toolu_${overrides.taskId}`,
		toolUseIds: [`toolu_${overrides.taskId}`],
		workflowName: "",
		scriptPath: "/fab/wf.js",
		transcriptDir: "/fab/transcripts",
		description: "",
		status: "running",
		summary: null,
		startedAt: STARTED_AT,
		durationMs: null,
		totalTokens: null,
		progress: [],
		...overrides,
	};
}

function done(index: number, label: string, phaseIndex: number, phaseTitle: string): WorkflowProgressEntry {
	return {
		type: "workflow_agent",
		index,
		label,
		agentId: `a${index}`,
		state: "done",
		phaseIndex,
		phaseTitle,
		model: "claude-opus-5-5",
		startedAt: STARTED_AT,
		tokens: 49_700,
		durationMs: 6000,
	};
}

/** Upstream run 1 `upstream-sync-wf-test`: 3 Draft poems, then a Review, 198.8k tokens in 35s. */
const COMPLETED_RUN = run({
	taskId: "waq2jn20y",
	workflowName: "upstream-sync-wf-test",
	description: "Tiny test: 3 parallel sea poems, then a one-word review",
	status: "completed",
	durationMs: 35_000,
	totalTokens: 198_800,
	progress: [
		{type: "workflow_phase", index: 0, title: "Draft"},
		{type: "workflow_phase", index: 1, title: "Review"},
		done(1, "poem-1", 0, "Draft"),
		done(2, "poem-2", 0, "Draft"),
		done(3, "poem-3", 0, "Draft"),
		done(4, "review", 1, "Review"),
	],
});

/** One agent writing in phase "Slow", 7s in. */
const SLOW_PROGRESS: WorkflowProgressEntry[] = [
	{type: "workflow_phase", index: 0, title: "Slow"},
	{
		type: "workflow_agent",
		index: 1,
		label: "story",
		agentId: "a1",
		state: "progress",
		phaseIndex: 0,
		phaseTitle: "Slow",
		model: "claude-opus-5-5",
		startedAt: STARTED_AT,
		lastProgressAt: NOW,
	},
];

const RUNNING_RUN = run({
	taskId: "wn2xo9rjo",
	workflowName: "upstream-sync-wf-stop",
	description: "Test: one agent writes a 600-word lighthouse keeper story",
	progress: SLOW_PROGRESS,
});

function phaseLabels(): (string | null)[] {
	return screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
}

function rowCells(row: HTMLElement): string[] {
	return [...row.children].map((cell) => cell.textContent);
}

describe("WorkflowTaskCard", () => {
	it("renders a completed run muted with its duration, counts, tokens and collapsed phases", () => {
		const {container} = render(
			<WorkflowTaskCard task={task({id: "waq2jn20y", status: "completed"})} run={COMPLETED_RUN} />,
		);
		const card = container.firstElementChild;
		expect(card?.className).toBe("flex flex-col gap-[24px] text-pretty rounded-r6 bg-alpha-1 p-2 pb-3");
		const title = screen.getByText("upstream-sync-wf-test");
		expect(title.className).toBe("flex-1 min-w-0 text-body break-words text-balance text-ink-muted");
		expect(title.nextElementSibling?.textContent).toBe("35s");
		expect(title.nextElementSibling?.className).toBe("shrink-0 text-footnote text-ink-muted tabular-nums pe-0.75");
		const metaRows = [...container.querySelectorAll("span.flex.flex-wrap.items-baseline")].map((row) =>
			[...row.children].map((child) => child.textContent),
		);
		expect(metaRows).toStrictEqual([
			["Workflow", "Completed"],
			["4 agents", "198.8k tokens"],
		]);
		expect(screen.getByText("Tiny test: 3 parallel sea poems, then a one-word review").className).toBe(
			"block text-footnote text-ink-muted break-words",
		);
		expect(screen.getByText("Phases").className).toBe("text-footnote font-medium text-ink-muted");
		expect(phaseLabels()).toStrictEqual([
			"Phase: Draft, Done, 3 of 3 agents done",
			"Phase: Review, Done, 1 of 1 agent done",
		]);
		expect(screen.getAllByRole("button").map((button) => button.getAttribute("aria-expanded"))).toStrictEqual([
			"false",
			"false",
		]);
		expect(screen.queryByText("Agent")).toBeNull();
	});

	it("expands a finished phase into its agents table with Done checks, models, tokens and durations", () => {
		render(<WorkflowTaskCard task={task({id: "waq2jn20y", status: "completed"})} run={COMPLETED_RUN} />);
		const draft = screen.getByRole("button", {name: "Phase: Draft, Done, 3 of 3 agents done"});
		fireEvent.click(draft);
		expect(draft.getAttribute("aria-expanded")).toBe("true");
		expect(draft.className).toBe(
			"text-start outline-none hide-focus-ring focus-visible:ring-focus w-full rounded-r3 px-2 pt-1 bg-alpha-1 pb-2",
		);
		expect(draft.parentElement?.className).toBe("flex flex-col gap-2 pb-3");
		const rows = screen.getAllByRole("listitem").filter((row) => row.className.startsWith("contents"));
		expect(rows.map(rowCells)).toStrictEqual([
			["", "poem-1", "Opus 5.5", "49.7k", "6s"],
			["", "poem-2", "Opus 5.5", "49.7k", "6s"],
			["", "poem-3", "Opus 5.5", "49.7k", "6s"],
		]);
		expect(rows.map((row) => row.className)).toStrictEqual([
			"contents text-ink-muted",
			"contents text-ink-muted",
			"contents text-ink-muted",
		]);
		expect(within(rows[0] ?? document.body).getByRole("img", {name: "Done"})).toBeTruthy();
	});

	it("opens a running run's phases with its live agents table and timers", () => {
		const {container} = render(<WorkflowTaskCard task={task({id: "wn2xo9rjo"})} run={RUNNING_RUN} />);
		expect(container.querySelector("[data-cds=ShimmerText]")?.className).toBe(
			"relative flex-1 min-w-0 text-body break-words text-balance text-primary",
		);
		const metaRows = [...container.querySelectorAll("span.flex.flex-wrap.items-baseline")].map((row) =>
			[...row.children].map((child) => child.textContent),
		);
		expect(metaRows).toStrictEqual([["Workflow", "7s"], ["1 agent"]]);
		expect(screen.getByText("Phases").className).toBe("text-footnote font-medium text-primary");
		const slow = screen.getByRole("button", {name: "Phase: Slow, Running, 0 of 1 agent done"});
		expect(slow.getAttribute("aria-expanded")).toBe("true");
		const row = screen.getAllByRole("listitem").find((item) => item.className.startsWith("contents"));
		expect(row?.className).toBe("contents text-secondary");
		expect(rowCells(row ?? document.body)).toStrictEqual(["", "story", "Opus 5.5", "", "7s"]);
		expect(screen.getByRole("img", {name: "0 of 1 agents done, 1 running, 0 stalled, 0 failed"})).toBeTruthy();
	});

	it("shows a stopped run's stopped phase and its summary region", () => {
		const stopped = run({
			...RUNNING_RUN,
			status: "stopped",
			summary: 'Workflow "upstream-sync-wf-stop" stopped: the user stopped it',
			durationMs: 4000,
		});
		render(<WorkflowTaskCard task={task({id: "wn2xo9rjo", status: "stopped"})} run={stopped} />);
		expect(phaseLabels()).toStrictEqual(["Phase: Slow, Stopped, 0 of 1 agent done"]);
		expect(screen.getByRole("region", {name: "Stopped"}).textContent).toBe("The user stopped it");
	});

	it("tints a failed run's summary region and marks its status in danger ink", () => {
		const failed = run({
			...COMPLETED_RUN,
			status: "failed",
			summary: 'Workflow "upstream-sync-wf-test" failed: script threw',
		});
		render(<WorkflowTaskCard task={task({id: "waq2jn20y", status: "failed"})} run={failed} />);
		expect(screen.getByText("Failed").className).toBe("text-danger");
		const region = screen.getByRole("region", {name: "Error"});
		expect(region.textContent).toBe("Script threw");
		expect(region.parentElement?.getAttribute("style")).toBe(
			"background: color-mix(in srgb, var(--color-fill-danger) 8%, transparent);",
		);
	});

	it("falls back to the task's own description with no run", () => {
		render(<WorkflowTaskCard task={task({id: "wx", description: "fab-flow", status: "completed"})} />);
		expect(screen.getByText("fab-flow")).toBeTruthy();
		expect(screen.queryByText("Phases")).toBeNull();
	});
});

describe("BackgroundTasksList workflows", () => {
	it("draws a workflow task as its workflow card, matched to its run by task id", () => {
		const {container} = render(
			<BackgroundTasksList
				groups={{running: [task({id: "wn2xo9rjo", description: "upstream-sync-wf-stop"})], finished: []}}
				workflowRuns={[RUNNING_RUN]}
			/>,
		);
		expect(container.querySelector("[data-task-id=wn2xo9rjo]")).not.toBeNull();
		expect(container.querySelector("button[data-background-task]")).toBeNull();
		expect(screen.getByRole("button", {name: "Phase: Slow, Running, 0 of 1 agent done"})).toBeTruthy();
	});
});
