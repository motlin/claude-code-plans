// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	BackgroundTasksOpenerProvider,
	type BackgroundTasksFocus,
} from "../src/components/background-tasks-opener-context";
import {SessionChat} from "../src/components/session-chat";
import {WorkflowCard} from "../src/components/tool-renderers/workflow-card";
import {processTranscript} from "../src/lib/transcript";
import type {WorkflowProgressEntry} from "../src/lib/workflow-progress";
import type {WorkflowRun} from "../src/lib/workflow-runs";

vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug: false,
		},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => (
{
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => (
{
	useClaudeEvents: () => (
	{
		failedTools: new Map(),
	}),
}));

class NoopResizeObserver
{
	observe()
	{
	}
	unobserve()
	{
	}
	disconnect()
	{
	}
	takeRecords(): ResizeObserverEntry[]
	{
		return [];
	}
}

globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = () =>
{
};

afterEach(() =>
{
	cleanup();
	vi.useRealTimers();
});

const TOOL_USE_ID = "toolu_wf";
const TASK_ID = "w1a2b3c4d";
const NAME = "upstream-sync-wf-test";
const NOW = Date.parse("2026-10-19T12:00:13.000Z");
const STARTED_AT = Date.parse("2026-10-19T12:00:00.000Z");

/** Upstream's xs cds Card root around the workflow CardLink. */
const CARD_CLASS =
	"group/card relative isolate flex flex-col rounded-card after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] has-[[data-cds=CardLink]:focus-visible]:after:shadow-focus has-[[data-cds=CardLink]:active]:after:bg-neutral-hover has-[[data-cds=CardLink]]:after:bg-fill-card has-[[data-cds=CardLink]]:not-has-[[data-cds=CardLink]:active]:hover:after:bg-fill-card-hover my-[var(--chat-card-bump,6px)] self-start min-w-[318px] max-w-[318px] text-start text-pretty";
const CARD_FILL_CLASS = "cds-card-fill pointer-events-none absolute inset-0 -z-[1] m-0 rounded-[inherit]";
const CARD_BODY_CLASS = "cds-card-body flex min-h-0 flex-1 flex-col self-stretch rounded-[inherit] p-p8";
const CARD_LINK_CLASS =
	"outline-none after:absolute after:inset-0 after:rounded-card after:contain-paint after:content-[''] cursor-pointer";

function agent(index: number, state: "start" | "progress" | "done"): WorkflowProgressEntry
{
	return {
		type: "workflow_agent",
		index,
		label: `Agent ${index}`,
		agentId: `a${index}`,
		state,
		phaseIndex: 0,
		phaseTitle: "Explore",
		startedAt: STARTED_AT,
		lastProgressAt: NOW - 1000,
	};
}

/** The live "1 of 3 agents done, 2 running" state. */
const RUNNING_PROGRESS: WorkflowProgressEntry[] = [
	{
		type: "workflow_phase",
		index: 0,
		title: "Explore",
	},
	agent(0, "done"),
	agent(1, "progress"),
	agent(2, "progress"),
];

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun
{
	return {
		runId: "wf_test-1",
		taskId: TASK_ID,
		toolUseId: TOOL_USE_ID,
		toolUseIds: [TOOL_USE_ID],
		workflowName: NAME,
		scriptPath: `/tmp/${NAME}.js`,
		transcriptDir: "/tmp/wf",
		description: "Explore and review",
		status: "running",
		summary: null,
		startedAt: STARTED_AT,
		durationMs: null,
		totalTokens: null,
		progress: RUNNING_PROGRESS,
		...overrides,
	};
}

const INPUT =
{
	scriptPath: `/Users/alice/.claude/workflows/${NAME}.js`,
	description: "Explore and review",
};

function records(launched: boolean): unknown[]
{
	const call =
	{
		type: "assistant",
		uuid: "a1",
		timestamp: "2026-10-19T11:59:59.000Z",
		message:
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: TOOL_USE_ID,
					name: "Workflow",
					input: INPUT,
				},
			],
		},
	};
	if (!launched) return [call];
	return [
		call,
		{
			type: "user",
			uuid: "u1",
			timestamp: "2026-10-19T12:00:00.000Z",
			toolUseResult:
			{
				status: "async_launched",
				taskId: TASK_ID,
				taskType: "local_workflow",
				workflowName: NAME,
				runId: "wf_test-1",
				summary: "Explore and review",
				transcriptDir: "/tmp/wf",
				scriptPath: INPUT.scriptPath,
			},
			message:
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: TOOL_USE_ID,
						content: "Workflow launched in background.",
					},
				],
			},
		},
	];
}

function chat(
	transcript: unknown[],
	workflowRuns: WorkflowRun[],
	open = vi.fn<(focus?: BackgroundTasksFocus) => void>(),
)
{
	const {lines, toolResultMap} = processTranscript(transcript);
	return (
		<BackgroundTasksOpenerProvider
			value={
			{
				open,
				running: new Map(),
			}}
		>
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				workflowRuns={workflowRuns}
				showCompactSummaries
				showTranscriptOnly
			/>
		</BackgroundTasksOpenerProvider>
	);
}

function renderChat(
	launched: boolean,
	workflowRuns: WorkflowRun[],
	open = vi.fn<(focus?: BackgroundTasksFocus) => void>(),
)
{
	return {
		...render(chat(records(launched), workflowRuns, open)),
		open,
	};
}

function cells(container: HTMLElement): string[]
{
	return [...container.querySelectorAll("[data-cell]")].map((cell) => cell.className);
}

describe("WorkflowCard", () =>
{
	it("shows a pre-launch card as Starting workflow with only the ghost cell", () =>
	{
		const onOpen = vi.fn<() => void>();
		const {container} = render(<WorkflowCard name={NAME} preLaunch progress={[]} onOpen={onOpen} />);
		const link = screen.getByRole(
			"button",
			{
				name: `View workflow: ${NAME}`,
			},
		);
		const card = container.firstElementChild as HTMLElement;
		fireEvent.click(link);
		fireEvent.keyDown(
			link,
			{
				key: "Enter",
			},
		);
		fireEvent.keyDown(
			link,
			{
				key: " ",
			},
		);
		fireEvent.keyDown(
			link,
			{
				key: "a",
			},
		);

		expect(
			{
				card:
				{
					cds: card.dataset["cds"],
					size: card.dataset["size"],
					className: card.className,
				},
				children: [...card.children].map((child) => child.className),
				link:
				{
					tag: link.tagName,
					cds: link.dataset["cds"],
					tabIndex: link.tabIndex,
					keepsPin: link.hasAttribute("data-transcript-keeps-pin"),
					className: link.className,
					parent: link.parentElement?.className,
				},
				text: link.textContent,
				cells: cells(container),
				summary: container.querySelector('[role="img"]')?.getAttribute("aria-label"),
				opens: onOpen.mock.calls.length,
			},
		).toStrictEqual(
			{
				card:
				{
					cds: "Card",
					size: "xs",
					className: CARD_CLASS,
				},
				children: [CARD_FILL_CLASS, CARD_BODY_CLASS],
				link:
				{
					tag: "SPAN",
					cds: "CardLink",
					tabIndex: 0,
					keepsPin: true,
					className: CARD_LINK_CLASS,
					parent: CARD_BODY_CLASS,
				},
				text: `${NAME}Starting workflow`,
				cells: ["epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--ghost"],
				summary: "Waiting for agents to start",
				opens: 3,
			},
		);
	});

	it("keeps the Workflow label a mounted, inactive default-variant ShimmerText once the card has a name", () =>
	{
		const labelFacts = (name: string) =>
		{
			const {container} = render(
				<WorkflowCard
					name={name}
					progress={[]}
					onOpen={() =>
					{
					}}
				/>,
			);
			const label = container.querySelector(".text-footnote > [data-cds=ShimmerText]");
			const facts =
			{
				text: label?.textContent,
				className: label?.className,
				shimmering: label?.getAttribute("data-shimmering"),
				variant: label?.getAttribute("data-variant") ?? null,
			};
			cleanup();
			return facts;
		};
		expect(
			{
				named: labelFacts(NAME),
				unnamed: labelFacts(""),
			},
		).toStrictEqual(
			{
				named:
				{
					text: "Workflow",
					className: "shrink-0 text-secondary",
					shimmering: "false",
					variant: null,
				},
				unnamed:
				{
					text: "Workflow",
					className: "shrink-0 text-secondary",
					shimmering: "true",
					variant: null,
				},
			},
		);
	});

	it("shows a running card's agent count, elapsed time and 3+1 cells", () =>
	{
		vi.useFakeTimers(
			{
				now: NOW,
				toFake: ["Date"],
			},
		);
		const {container} = render(
			<WorkflowCard
				name={NAME}
				startedAt={STARTED_AT}
				progress={RUNNING_PROGRESS}
				onOpen={() =>
				{
				}}
			/>,
		);
		const meta = container.querySelector(".text-footnote");

		expect(
			{
				meta: meta?.textContent,
				metaClass: meta?.className,
				count: meta?.querySelector(".whitespace-nowrap")?.innerHTML,
				cells: cells(container),
				summary: container.querySelector('[role="img"]')?.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				meta: "Workflow3 agents13s",
				metaClass: "flex min-w-0 items-center gap-2 text-footnote text-ink-muted tabular-nums",
				count: '<span class="text-secondary">3</span> agents',
				cells: [
					"epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--done",
					"epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--running",
					"epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--running",
					"epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--ghost",
				],
				summary: "1 of 3 agents done, 2 running, 0 stalled, 0 failed",
			},
		);
	});

	it("says View workflow when there is no name", () =>
	{
		render(
			<WorkflowCard
				name=""
				preLaunch
				progress={[]}
				onOpen={() =>
				{
				}}
			/>,
		);

		expect(screen.getByRole("button").getAttribute("aria-label")).toBe("View workflow");
	});

	it("renders a non-clickable div without a chevron when no pane can open", () =>
	{
		const {container} = render(<WorkflowCard name={NAME} preLaunch progress={[]} />);

		expect(
			{
				buttons: screen.queryAllByRole("button").length,
				className: (container.firstElementChild as HTMLElement).className,
				body: container.querySelector("[data-cds-card-body]")?.firstElementChild?.className,
				svgs: container.querySelectorAll("svg").length,
			},
		).toStrictEqual(
			{
				buttons: 0,
				className: CARD_CLASS,
				body: "flex min-w-0 items-center gap-xs",
				svgs: 0,
			},
		);
	});
});

describe("Workflow call in the session transcript", () =>
{
	it("draws a pre-launch call as the Starting workflow card", async () =>
	{
		renderChat(false, []);
		const card = await screen.findByRole(
			"button",
			{
				name: `View workflow: ${NAME}`,
			},
		);

		expect(card.textContent).toBe(`${NAME}Starting workflow`);
	});

	it("draws a running launch as the card and opens the Background tasks pane at its task", async () =>
	{
		const {open, container} = renderChat(true, [run()]);
		fireEvent.click(
			await screen.findByRole(
				"button",
				{
					name: `View workflow: ${NAME}`,
				},
			),
		);

		expect(
			{
				anchor: container.querySelector(`[data-tool-anchor="${TOOL_USE_ID}"]`)?.className,
				calls: open.mock.calls,
			},
		).toStrictEqual(
			{
				anchor: "contents",
				calls: [
					[
						{
							taskId: TASK_ID,
						},
					],
				],
			},
		);
	});

	it("keeps a call that was live at mount a Starting workflow card until its run record arrives, as upstream's Rw latch", async () =>
	{
		vi.useFakeTimers(
			{
				now: NOW,
				toFake: ["Date"],
			},
		);
		const {rerender} = render(chat(records(false), []));
		await screen.findByRole(
			"button",
			{
				name: `View workflow: ${NAME}`,
			},
		);
		rerender(chat(records(true), []));
		const launched = screen.queryByRole(
			"button",
			{
				name: `View workflow: ${NAME}`,
			},
		)?.textContent;
		rerender(chat(records(true), [run()]));

		expect(
			{
				launched,
				running: screen.queryByRole(
					"button",
					{
						name: `View workflow: ${NAME}`,
					},
				)?.textContent,
			},
		).toStrictEqual(
			{
				launched: `${NAME}Starting workflow`,
				running: `${NAME}Workflow3 agents13s`,
			},
		);
	});

	it("draws a call already completed at mount with no run record as the row", async () =>
	{
		renderChat(true, []);
		await screen.findByText("Ran workflow");

		expect(
			screen.queryByRole(
				"button",
				{
					name: `View workflow: ${NAME}`,
				},
			),
		).toBeNull();
	});

	it("draws a completed launch as a row, not a card", async () =>
	{
		renderChat(true, [
			run(
				{
					status: "completed",
				},
			),
		]);
		await screen.findByText("Ran workflow");

		expect(
			screen.queryByRole(
				"button",
				{
					name: `View workflow: ${NAME}`,
				},
			),
		).toBeNull();
	});
});

const LAUNCH_TEXT = `Workflow launched in background. Task ID: ${TASK_ID}\nSummary: Explore and review\nRun ID: wf_test-1`;

function settledRecords(extra: unknown[]): unknown[]
{
	const [call, launch] = records(true) as [
		unknown,
		{
			message:
			{
				content: Array<Record<string, unknown>>;
			};
		},
	];
	launch.message.content[0] =
	{
		...launch.message.content[0],
		content: LAUNCH_TEXT,
	};
	return [call, launch, ...extra];
}

function workflowNotification(status: string, summary: string): unknown
{
	return {
		type: "user",
		uuid: "u-note",
		timestamp: "2026-10-19T12:01:00.000Z",
		message:
		{
			role: "user",
			content: [
				"<task-notification>",
				`<task-id>${TASK_ID}</task-id>`,
				`<tool-use-id>${TOOL_USE_ID}</tool-use-id>`,
				`<status>${status}</status>`,
				`<summary>${summary}</summary>`,
				"</task-notification>",
			].join("\n"),
		},
	};
}

const TASK_STOP_RECORDS: unknown[] = [
	{
		type: "assistant",
		uuid: "a2",
		timestamp: "2026-10-19T12:00:30.000Z",
		message:
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_stop",
					name: "TaskStop",
					input:
					{
						task_id: TASK_ID,
					},
				},
			],
		},
	},
	{
		type: "user",
		uuid: "u2",
		timestamp: "2026-10-19T12:00:31.000Z",
		message:
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "toolu_stop",
					content: `Successfully stopped task: ${TASK_ID}`,
				},
			],
		},
	},
];

function renderSettled(
	extra: unknown[],
	workflowRuns: WorkflowRun[] = [],
	open = vi.fn<(focus?: BackgroundTasksFocus) => void>(),
)
{
	const {lines, toolResultMap} = processTranscript(settledRecords(extra));
	return render(
		<BackgroundTasksOpenerProvider
			value={
			{
				open,
				running: new Map(),
			}}
		>
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				workflowRuns={workflowRuns}
				showCompactSummaries
				showTranscriptOnly
			/>
		</BackgroundTasksOpenerProvider>,
	);
}

function launchRow(container: HTMLElement): HTMLElement
{
	const row = [...container.querySelectorAll<HTMLElement>("[data-tool-row]")].find((element) =>
		element.textContent.startsWith("Ran workflow"),
	);
	if (row === undefined) throw new Error("no Ran workflow row");
	return row;
}

describe("settled Workflow row", () =>
{
	it("reads Ran workflow and the name, with no disclosure or body", async () =>
	{
		const {container} = renderSettled(
			[],
			[
				run(
					{
						status: "completed",
					},
				),
			],
		);
		await screen.findByText("Ran workflow");
		const row = launchRow(container);

		expect(
			{
				text: row.textContent,
				disclosures: row.querySelectorAll("[aria-expanded]").length,
			},
		).toStrictEqual(
			{
				text: `Ran workflow${NAME}Ran workflow ${NAME}`,
				disclosures: 0,
			},
		);
	});

	it("gives a failed run's status a summary tooltip and a coarse-pointer inline summary", async () =>
	{
		const {container} = renderSettled(
			[workflowNotification("failed", `Workflow "${NAME}" failed: agent crashed\nwhile exploring`)],
			[
				run(
					{
						status: "failed",
					},
				),
			],
		);
		await screen.findByText("Ran workflow");
		const row = launchRow(container);
		const status = row.querySelector<HTMLElement>('[id$="-outcome"]');
		if (status === null) throw new Error("no Failed status");
		fireEvent.focus(status);
		const tooltip = await screen.findByRole("tooltip");

		expect(
			{
				text: status.textContent,
				tabIndex: status.tabIndex,
				statusClass: status.className,
				tooltip: tooltip.querySelector(".line-clamp-3")?.outerHTML,
				coarse: row.querySelector(".hidden")?.outerHTML,
			},
		).toStrictEqual(
			{
				text: "Failed",
				tabIndex: 0,
				statusClass:
					"shrink-0 text-body outline-none hide-focus-ring focus-visible:ring-focus rounded-r2 text-danger",
				tooltip: '<span class="line-clamp-3 whitespace-pre-wrap">Agent crashed\nwhile exploring</span>',
				coarse: '<span class="hidden [@media(pointer:coarse)]:block text-body text-secondary truncate min-w-0">Agent crashed\nwhile exploring</span>',
			},
		);
	});

	it("draws the settled row as upstream's TurnStatusStep button that opens Background tasks at its task", async () =>
	{
		const open = vi.fn<(focus?: BackgroundTasksFocus) => void>();
		const {container} = renderSettled(
			[],
			[
				run(
					{
						status: "completed",
					},
				),
			],
			open,
		);
		await screen.findByText("Ran workflow");
		const row = launchRow(container);
		const button = row.querySelector<HTMLButtonElement>("button");
		if (button === null) throw new Error("no step button");
		const subject = button.querySelector("[data-cds-row-subject]");

		expect(
			{
				step: button.closest("[data-cds=TurnStatusStep]")?.className,
				type: button.type,
				title: button.dataset["cdsRowTitle"],
				titleWhenCut: button.dataset["cdsRowTitleWhenCut"],
				buttonClass: button.className,
				label: button.querySelector('[id$="-label"] > [data-morph-key] > *')?.className,
				subject: subject?.className,
				subjectText: subject?.querySelector("bdi")?.textContent,
				buttons: row.querySelectorAll("button").length,
			},
		).toStrictEqual(
			{
				step: "flex w-full min-w-0 flex-col",
				type: "button",
				title: NAME,
				titleWhenCut: "subject",
				buttonClass:
					"group/step flex min-w-0 w-stretch px-xs ms-[calc(var(--cds-assistant-message-text-inset,0px)_-_var(--cds-outset-x,0px)_-_var(--cds-turn-status-hang,0px))] me-[calc(var(--cds-assistant-message-text-stop,0px)_-_var(--cds-outset-x,0px))] py-[calc((var(--cds-h-control)_-_1lh)_/_2)] items-center gap-xs text-start font-sans text-body font-normal cursor-pointer select-none border-0 bg-transparent rounded outline-none hide-focus-ring focus-visible:outline-hidden focus-visible:outline-offset-[-2px] focus-visible:[box-shadow:inset_0_0_0_1px_var(--cds-fill-accent)] transition-shadow duration-fast",
				label: "shrink-0 text-body text-secondary",
				subject:
					"min-w-0 truncate text-body text-primary py-[0.125em] -my-[0.125em] underline decoration-(--_text-link-line) underline-offset-[3px] transition-none [--_text-link-line:transparent] [@media(hover:none)]:[--_text-link-line:color-mix(in_srgb,currentColor,transparent_35%)] group-hover/step:[--_text-link-line:color-mix(in_srgb,currentColor_100%,transparent)] group-focus-visible/step:[--_text-link-line:color-mix(in_srgb,currentColor_100%,transparent)]",
				subjectText: NAME,
				buttons: 1,
			},
		);

		fireEvent.click(button);
		expect(open.mock.calls).toStrictEqual([
			[
				{
					taskId: TASK_ID,
				},
			],
		]);
	});

	it("draws a failed run's label in danger ink", async () =>
	{
		const {container} = renderSettled(
			[workflowNotification("failed", `Workflow "${NAME}" failed: agent crashed`)],
			[
				run(
					{
						status: "failed",
					},
				),
			],
		);
		await screen.findByText("Ran workflow");

		expect(launchRow(container).querySelector('[id$="-label"] > [data-morph-key] > *')?.className).toBe(
			"shrink-0 text-body text-danger",
		);
	});

	it("marks the row Stopped when a TaskStop ended its task", async () =>
	{
		const {container} = renderSettled(TASK_STOP_RECORDS, [
			run(
				{
					status: "completed",
				},
			),
		]);
		await screen.findByText("Ran workflow");

		const row = launchRow(container);
		expect(
			{
				text: row.textContent,
				stopped: row.querySelector("button > span.shrink-0.text-secondary:last-child")?.textContent,
			},
		).toStrictEqual(
			{
				text: `Ran workflow${NAME}StoppedRan workflow ${NAME} Stopped`,
				stopped: "Stopped",
			},
		);
	});
});

describe("errored Workflow call", () =>
{
	it("reads Running workflow with the name and a Failed status, as upstream's failed step", async () =>
	{
		const [call] = records(false);
		const {container} = render(
			chat(
				[
					call,
					{
						type: "user",
						uuid: "u1",
						timestamp: "2026-10-19T12:00:00.000Z",
						toolUseResult: "Error: Workflow script not found",
						message:
						{
							role: "user",
							content: [
								{
									type: "tool_result",
									tool_use_id: TOOL_USE_ID,
									is_error: true,
									content: "<tool_use_error>Workflow script not found</tool_use_error>",
								},
							],
						},
					},
				],
				[],
			),
		);
		await screen.findByText("Running workflow");
		const row = [...container.querySelectorAll<HTMLElement>("[data-tool-row]")].find((element) =>
			element.textContent.startsWith("Running workflow"),
		);

		expect(
			{
				cards: screen.queryAllByRole(
					"button",
					{
						name: `View workflow: ${NAME}`,
					},
				).length,
				label: row?.querySelector('[id$="-label"]')?.textContent,
				meta: row?.querySelector('[id$="-meta"]')?.textContent,
				outcome: row?.querySelector('[id$="-outcome"]')?.textContent ?? null,
			},
		).toStrictEqual(
			{
				cards: 0,
				label: "Running workflow",
				meta: NAME,
				outcome: "Failed",
			},
		);
	});
});
