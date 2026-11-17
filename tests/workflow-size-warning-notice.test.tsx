// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import
{
	type BackgroundTasksFocus,
	type BackgroundTasksOpener,
	BackgroundTasksOpenerProvider,
} from "../src/components/background-tasks-opener-context";
import {useComposerNotice} from "../src/components/composer-notice-context";
import {ComposerNoticeProvider, ComposerNoticeRegion} from "../src/components/composer-notice-region";
import {WorkflowSizeWarningNotice} from "../src/components/workflow-size-warning-notice";
import {resetWorkflowSizeStore} from "../src/lib/workflow-size-store";
import type {WorkflowAgentEntry} from "../src/lib/workflow-progress";
import type {WorkflowRun} from "../src/lib/workflow-runs";

let visibility: DocumentVisibilityState = "visible";

beforeEach(() =>
{
	visibility = "visible";
	vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
	resetWorkflowSizeStore();
});

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

function agents(count: number): WorkflowAgentEntry[]
{
	return Array.from(
		{
			length: count,
		},
		(_, i): WorkflowAgentEntry => (
		{
			type: "workflow_agent",
			index: i + 1,
			label: `agent ${i + 1}`,
			agentId: `a${i + 1}`,
			state: "progress",
			startedAt: 1_790_000_000_000,
		}),
	);
}

function run(taskId: string, agentCount: number, fields: Partial<WorkflowRun> = {}): WorkflowRun
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
		progress: agents(agentCount),
		...fields,
	};
}

function UsageBand()
{
	useComposerNotice(
		"limit",
		{
			id: "usage",
			content: <div data-testid="usage-band" />,
		},
	);
	return null;
}

interface Props
{
	runs: readonly WorkflowRun[] | undefined;
	refusalShown?: boolean;
	opener?: BackgroundTasksOpener | null;
	usage?: boolean;
}

function ui({runs, refusalShown = false, opener = null, usage = false}: Props)
{
	return (
		<BackgroundTasksOpenerProvider value={opener}>
			<ComposerNoticeProvider>
				<ComposerNoticeRegion />
				{usage && <UsageBand />}
				<WorkflowSizeWarningNotice runs={runs} refusalShown={refusalShown} />
			</ComposerNoticeProvider>
		</BackgroundTasksOpenerProvider>
	);
}

function opener()
{
	return {
		open: vi.fn<(focus?: BackgroundTasksFocus) => void>(),
		running: new Map(),
	};
}

const cards = () => [
	...document.querySelectorAll<HTMLElement>(
		'[data-cds-dock-card]:not([data-cds-dock-leaving]) [data-testid="workflow-size-card"]',
	),
];

describe("WorkflowSizeWarningNotice", () =>
{
	it("draws upstream's workflow-size-card for a running run over 25 agents", () =>
	{
		render(
			ui(
				{
					runs: [run("w1", 107)],
					opener: opener(),
				},
			),
		);

		const [card, ...rest] = cards();
		expect(rest).toStrictEqual([]);
		expect(card?.getAttribute("data-cds")).toBe("Banner");
		expect(card?.querySelector('[aria-atomic="true"]')?.textContent).toBe(
			"upstream-sync is larger than most workflows. Up to 107 agents scheduled.",
		);
		const bdi = card?.querySelector("bdi.font-medium");
		expect(bdi?.textContent).toBe("upstream-sync");
		expect(bdi?.parentElement?.tagName).toBe("SPAN");
		expect(bdi?.parentElement?.hasAttribute("class")).toBe(false);
		expect(card?.querySelector(".text-muted-as-secondary")?.textContent).toBe("Up to 107 agents scheduled.");
		const view = screen.getByRole(
			"button",
			{
				name: "View workflow",
			},
		);
		expect(view.textContent).toBe("View");
		expect(
			screen.queryByRole(
				"button",
				{
					name: "Stop workflow",
				},
			),
		).toBeNull();
	});

	it("opens the Background tasks pane at the run on View", () =>
	{
		const tasks = opener();
		render(
			ui(
				{
					runs: [run("w1", 30)],
					opener: tasks,
				},
			),
		);

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "View workflow",
				},
			),
		);
		expect(tasks.open.mock.calls).toStrictEqual([
			[
				{
					taskId: "w1",
					finished: false,
				},
			],
		]);
	});

	it("stays dismissed for its task while another big run can take the slot", () =>
	{
		const {rerender} = render(
			ui(
				{
					runs: [run("w1", 30)],
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Dismiss",
				},
			),
		);
		expect(cards()).toStrictEqual([]);

		rerender(
			ui(
				{
					runs: [run("w1", 30)],
				},
			),
		);
		expect(cards()).toStrictEqual([]);

		rerender(
			ui(
				{
					runs: [run("w1", 30), run("w2", 40)],
				},
			),
		);
		expect(cards().map((card) => card.querySelector(".text-muted-as-secondary")?.textContent)).toStrictEqual([
			"Up to 40 agents scheduled.",
		]);
	});

	it("leaves when the run finishes and shows a new running task", () =>
	{
		const {rerender} = render(
			ui(
				{
					runs: [run("w1", 30)],
				},
			),
		);
		expect(cards()).toHaveLength(1);

		rerender(
			ui(
				{
					runs: [
						run(
							"w1",
							30,
							{
								status: "completed",
							},
						),
					],
				},
			),
		);
		expect(cards()).toStrictEqual([]);

		rerender(
			ui(
				{
					runs: [
						run(
							"w1",
							30,
							{
								status: "completed",
							},
						),
						run("w2", 28),
					],
				},
			),
		);
		expect(cards().map((card) => card.querySelector(".text-muted-as-secondary")?.textContent)).toStrictEqual([
			"Up to 28 agents scheduled.",
		]);
	});

	it("drops the action slot without an opener", () =>
	{
		render(
			ui(
				{
					runs: [run("w1", 30)],
				},
			),
		);
		expect(cards()).toHaveLength(1);
		expect(
			screen.queryByRole(
				"button",
				{
					name: "View workflow",
				},
			),
		).toBeNull();
		expect(
			[...(cards()[0]?.querySelectorAll("button") ?? [])].map((button) => button.getAttribute("aria-label")),
		).toStrictEqual(["Dismiss"]);
	});

	it("hides while the document is hidden", () =>
	{
		visibility = "hidden";
		render(
			ui(
				{
					runs: [run("w1", 30)],
				},
			),
		);
		expect(cards()).toStrictEqual([]);

		visibility = "visible";
		act(() =>
		{
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(cards()).toHaveLength(1);
	});

	it("yields to the refusal band", () =>
	{
		render(
			ui(
				{
					runs: [run("w1", 30)],
					refusalShown: true,
				},
			),
		);
		expect(cards()).toStrictEqual([]);
	});

	it("uses the unnamed copy for a run with no name", () =>
	{
		render(
			ui(
				{
					runs: [
						run(
							"w1",
							26,
							{
								workflowName: "",
							},
						),
					],
				},
			),
		);
		expect(cards()[0]?.querySelector('[aria-atomic="true"]')?.textContent).toBe(
			"This workflow is larger than most. Up to 26 agents scheduled, more than most workflows use.",
		);
	});

	it("draws the tokens and both axes with compact token labels", () =>
	{
		const {rerender} = render(
			ui(
				{
					runs: [
						run(
							"w1",
							2,
							{
								totalTokens: 1_600_000,
							},
						),
					],
				},
			),
		);
		expect(cards()[0]?.querySelector(".text-muted-as-secondary")?.textContent).toBe(
			"As many as 1.6M tokens projected.",
		);

		rerender(
			ui(
				{
					runs: [
						run(
							"w1",
							107,
							{
								totalTokens: 15_274_469,
							},
						),
					],
				},
			),
		);
		expect(cards()[0]?.querySelector(".text-muted-as-secondary")?.textContent).toBe(
			"Up to 107 agents scheduled, about 15.3M tokens projected.",
		);
	});

	it("draws nothing for a small run", () =>
	{
		render(
			ui(
				{
					runs: [run("w1", 20)],
				},
			),
		);
		expect(cards()).toStrictEqual([]);
	});

	it("stacks before the usage band in NOTICE_ORDER", () =>
	{
		render(
			ui(
				{
					runs: [run("w1", 30)],
					usage: true,
				},
			),
		);
		const items = [...document.querySelectorAll("[data-cds-dock-card]")].map((item) =>
			item.querySelector("[data-testid]")?.getAttribute("data-testid"),
		);
		expect(items).toStrictEqual(["workflow-size-card", "usage-band"]);
	});
});
