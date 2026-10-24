// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {
	BackgroundTasksOpenerProvider,
	type BackgroundTasksFocus,
} from "../src/components/background-tasks-opener-context";
import {SessionChat} from "../src/components/session-chat";
import {WorkflowCard} from "../src/components/tool-renderers/workflow-card";
import {processTranscript} from "../src/lib/transcript";
import type {WorkflowProgressEntry} from "../src/lib/workflow-progress";
import type {WorkflowRun} from "../src/lib/workflow-runs";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({settings: {showDebug: false}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class NoopResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords(): ResizeObserverEntry[] {
		return [];
	}
}

globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

const TOOL_USE_ID = "toolu_wf";
const TASK_ID = "w1a2b3c4d";
const NAME = "upstream-sync-wf-test";
const NOW = Date.parse("2026-10-19T12:00:13.000Z");
const STARTED_AT = Date.parse("2026-10-19T12:00:00.000Z");

const CARD_CLASS =
	"group/tool my-[6px] relative isolate flex self-start min-w-[318px] max-w-[318px] items-start gap-g5 rounded-r6 ps-3 py-2.5 text-start text-pretty group/btn outline-none hide-focus-ring focus-visible:ring-focus pe-2";

function agent(index: number, state: "start" | "progress" | "done"): WorkflowProgressEntry {
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
	{type: "workflow_phase", index: 0, title: "Explore"},
	agent(0, "done"),
	agent(1, "progress"),
	agent(2, "progress"),
];

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
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

const INPUT = {scriptPath: `/Users/alice/.claude/workflows/${NAME}.js`, description: "Explore and review"};

function records(launched: boolean): unknown[] {
	const call = {
		type: "assistant",
		uuid: "a1",
		timestamp: "2026-10-19T11:59:59.000Z",
		message: {role: "assistant", content: [{type: "tool_use", id: TOOL_USE_ID, name: "Workflow", input: INPUT}]},
	};
	if (!launched) return [call];
	return [
		call,
		{
			type: "user",
			uuid: "u1",
			timestamp: "2026-10-19T12:00:00.000Z",
			toolUseResult: {
				status: "async_launched",
				taskId: TASK_ID,
				taskType: "local_workflow",
				workflowName: NAME,
				runId: "wf_test-1",
				summary: "Explore and review",
				transcriptDir: "/tmp/wf",
				scriptPath: INPUT.scriptPath,
			},
			message: {
				role: "user",
				content: [{type: "tool_result", tool_use_id: TOOL_USE_ID, content: "Workflow launched in background."}],
			},
		},
	];
}

function renderChat(
	launched: boolean,
	workflowRuns: WorkflowRun[],
	open = vi.fn<(focus?: BackgroundTasksFocus) => void>(),
) {
	const {lines, toolResultMap} = processTranscript(records(launched));
	const view = render(
		<BackgroundTasksOpenerProvider value={{open, running: new Map()}}>
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
	return {...view, open};
}

function cells(container: HTMLElement): string[] {
	return [...container.querySelectorAll("[data-cell]")].map((cell) => cell.className);
}

describe("WorkflowCard", () => {
	it("shows a pre-launch card as Starting workflow with only the ghost cell", () => {
		const {container} = render(<WorkflowCard name={NAME} preLaunch progress={[]} onOpen={() => {}} />);
		const card = screen.getByRole("button", {name: `View workflow: ${NAME}`});

		expect({
			className: card.className,
			text: card.textContent,
			cells: cells(container),
			summary: container.querySelector('[role="img"]')?.getAttribute("aria-label"),
		}).toStrictEqual({
			className: CARD_CLASS,
			text: `${NAME}${NAME}Starting workflow`,
			cells: ["epitaxy-agent-cell shrink-0 rounded-xs epitaxy-agent-cell--ghost"],
			summary: "Waiting for agents to start",
		});
	});

	it("shows a running card's agent count, elapsed time and 3+1 cells", () => {
		vi.useFakeTimers({now: NOW, toFake: ["Date"]});
		const {container} = render(
			<WorkflowCard name={NAME} startedAt={STARTED_AT} progress={RUNNING_PROGRESS} onOpen={() => {}} />,
		);
		const meta = container.querySelector(".text-footnote");

		expect({
			meta: meta?.textContent,
			metaClass: meta?.className,
			count: meta?.querySelector(".whitespace-nowrap")?.innerHTML,
			cells: cells(container),
			summary: container.querySelector('[role="img"]')?.getAttribute("aria-label"),
		}).toStrictEqual({
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
		});
	});

	it("says View workflow when there is no name", () => {
		render(<WorkflowCard name="" preLaunch progress={[]} onOpen={() => {}} />);

		expect(screen.getByRole("button").getAttribute("aria-label")).toBe("View workflow");
	});

	it("renders a non-clickable div without a chevron when no pane can open", () => {
		const {container} = render(<WorkflowCard name={NAME} preLaunch progress={[]} />);

		expect({
			buttons: screen.queryAllByRole("button").length,
			className: (container.firstElementChild as HTMLElement).className,
			svgs: container.querySelectorAll("svg").length,
		}).toStrictEqual({
			buttons: 0,
			className:
				"group/tool my-[6px] relative isolate flex self-start min-w-[318px] max-w-[318px] items-start gap-g5 rounded-r6 ps-3 py-2.5 text-start text-pretty pe-4",
			svgs: 0,
		});
	});
});

describe("Workflow call in the session transcript", () => {
	it("draws a pre-launch call as the Starting workflow card", async () => {
		renderChat(false, []);
		const card = await screen.findByRole("button", {name: `View workflow: ${NAME}`});

		expect(card.textContent).toBe(`${NAME}${NAME}Starting workflow`);
	});

	it("draws a running launch as the card and opens the Background tasks pane at its task", async () => {
		const {open, container} = renderChat(true, [run()]);
		fireEvent.click(await screen.findByRole("button", {name: `View workflow: ${NAME}`}));

		expect({
			anchor: container.querySelector(`[data-tool-anchor="${TOOL_USE_ID}"]`)?.className,
			calls: open.mock.calls,
		}).toStrictEqual({anchor: "contents", calls: [[{taskId: TASK_ID}]]});
	});

	it("draws a completed launch as a row, not a card", async () => {
		renderChat(true, [run({status: "completed"})]);
		await screen.findByText("Ran workflow");

		expect(screen.queryByRole("button", {name: `View workflow: ${NAME}`})).toBeNull();
	});
});

const LAUNCH_TEXT = `Workflow launched in background. Task ID: ${TASK_ID}\nSummary: Explore and review\nRun ID: wf_test-1`;

function settledRecords(extra: unknown[]): unknown[] {
	const [call, launch] = records(true) as [unknown, {message: {content: Array<Record<string, unknown>>}}];
	launch.message.content[0] = {...launch.message.content[0], content: LAUNCH_TEXT};
	return [call, launch, ...extra];
}

function workflowNotification(status: string, summary: string): unknown {
	return {
		type: "user",
		uuid: "u-note",
		timestamp: "2026-10-19T12:01:00.000Z",
		message: {
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
		message: {
			role: "assistant",
			content: [{type: "tool_use", id: "toolu_stop", name: "TaskStop", input: {task_id: TASK_ID}}],
		},
	},
	{
		type: "user",
		uuid: "u2",
		timestamp: "2026-10-19T12:00:31.000Z",
		message: {
			role: "user",
			content: [
				{type: "tool_result", tool_use_id: "toolu_stop", content: `Successfully stopped task: ${TASK_ID}`},
			],
		},
	},
];

function renderSettled(extra: unknown[], workflowRuns: WorkflowRun[] = []) {
	const {lines, toolResultMap} = processTranscript(settledRecords(extra));
	return render(
		<BackgroundTasksOpenerProvider
			value={{open: vi.fn<(focus?: BackgroundTasksFocus) => void>(), running: new Map()}}
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

function launchRow(container: HTMLElement): HTMLElement {
	const row = [...container.querySelectorAll<HTMLElement>("[data-tool-row]")].find((element) =>
		element.textContent.startsWith("Ran workflow"),
	);
	if (row === undefined) throw new Error("no Ran workflow row");
	return row;
}

describe("settled Workflow row", () => {
	it("reads Ran workflow and the name, with no disclosure or body", async () => {
		const {container} = renderSettled([], [run({status: "completed"})]);
		await screen.findByText("Ran workflow");
		const row = launchRow(container);

		expect({
			text: row.textContent,
			disclosures: row.querySelectorAll("[aria-expanded]").length,
			name: [...row.querySelectorAll("span")].find((span) => span.textContent === NAME)?.className,
		}).toStrictEqual({
			text: `Ran workflow${NAME}Ran workflow ${NAME}`,
			disclosures: 0,
			name: "truncate min-w-0 text-body text-secondary",
		});
	});

	it("gives a failed run's status a summary tooltip and a coarse-pointer inline summary", async () => {
		const {container} = renderSettled(
			[workflowNotification("failed", `Workflow "${NAME}" failed: agent crashed\nwhile exploring`)],
			[run({status: "failed"})],
		);
		await screen.findByText("Ran workflow");
		const row = launchRow(container);
		const status = row.querySelector<HTMLElement>('[id$="-outcome"]');
		if (status === null) throw new Error("no Failed status");
		fireEvent.focus(status);
		const tooltip = await screen.findByRole("tooltip");

		expect({
			text: status.textContent,
			tabIndex: status.tabIndex,
			statusClass: status.className,
			tooltip: tooltip.querySelector(".line-clamp-3")?.outerHTML,
			coarse: row.querySelector(".hidden")?.outerHTML,
		}).toStrictEqual({
			text: "Failed",
			tabIndex: 0,
			statusClass:
				"shrink-0 text-body outline-none hide-focus-ring focus-visible:ring-focus rounded-r2 text-danger-ink",
			tooltip: '<span class="line-clamp-3 whitespace-pre-wrap">Agent crashed\nwhile exploring</span>',
			coarse: '<span class="hidden [@media(pointer:coarse)]:block text-body text-secondary truncate min-w-0">Agent crashed\nwhile exploring</span>',
		});
	});

	it("marks the row Stopped when a TaskStop ended its task", async () => {
		const {container} = renderSettled(TASK_STOP_RECORDS, [run({status: "completed"})]);
		await screen.findByText("Ran workflow");

		expect(launchRow(container).textContent).toBe(`Ran workflow${NAME}StoppedRan workflow ${NAME} Stopped`);
	});
});
