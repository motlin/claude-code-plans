// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
import {collectFindRanges} from "../src/lib/find-in-page/match";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug: false,
			codeThemeLight: "claude-light",
			codeThemeDark: "github-dark",
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

class FakeResizeObserver
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
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(
		HTMLElement.prototype,
		"scrollIntoView",
		{
			configurable: true,
			value: vi.fn<HTMLElement["scrollIntoView"]>(),
		},
	);
});
afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const STDOUT = "fabricated stdout zephyr";
const PROSE = "Fabricated reply about quokkas";

function user(uuid: string, content: unknown, extra: Record<string, unknown> = {}): unknown
{
	return {
		type: "user",
		uuid,
		...extra,
		message:
		{
			role: "user",
			content,
		},
	};
}

function assistant(uuid: string, content: unknown[]): unknown
{
	return {
		type: "assistant",
		uuid,
		message:
		{
			id: `msg-${uuid}`,
			role: "assistant",
			content,
		},
	};
}

function text(value: string): unknown
{
	return {
		type: "text",
		text: value,
	};
}

/** A tool call and its result, as two records. */
function call(id: string, name: string, input: Record<string, unknown>, result: string): unknown[]
{
	return [
		assistant(`a-${id}`, [
			{
				type: "tool_use",
				id,
				name,
				input,
			},
		]),
		user(`r-${id}`, [
			{
				type: "tool_result",
				tool_use_id: id,
				content: result,
			},
		]),
	];
}

const NOTIFICATION = [
	"<task-notification>",
	"<task-id>b1x2y3</task-id>",
	"<tool-use-id>toolu_bg</tool-use-id>",
	"<output-file>/private/tmp/tasks/b1x2y3.output</output-file>",
	"<status>completed</status>",
	'<summary>Background command "Run the suite" completed (exit code 0)</summary>',
	"</task-notification>",
].join("\n");

const RECORDS: unknown[] = [
	user("u-1", "Fabricated request"),
	...call(
		"toolu_bash",
		"Bash",
		{
			command: "echo zephyr",
			description: "Print the word",
		},
		STDOUT,
	),
	assistant("a-t1", [text("Between rows one.")]),
	...call("toolu_plan", "EnterPlanMode", {}, "Entered plan mode"),
	assistant("a-t2", [text("Between rows two.")]),
	...call(
		"toolu_agent",
		"Agent",
		{
			description: "Survey the code",
			prompt: "Look around",
		},
		"Agent finished",
	),
	assistant("a-t3", [text("Between rows three.")]),
	...call(
		"toolu_g1",
		"Bash",
		{
			command: "ls",
		},
		"one",
	),
	...call(
		"toolu_g2",
		"Bash",
		{
			command: "pwd",
		},
		"two",
	),
	assistant("a-t4", [text("Between rows four.")]),
	...call(
		"toolu_bg",
		"Bash",
		{
			command: "pnpm test",
			description: "Run the suite",
			run_in_background: true,
		},
		"Command running in background",
	),
	assistant("a-t5", [text("Running in the background.")]),
	user(
		"n-1",
		NOTIFICATION,
		{
			promptSource: "system",
			turnOrigin: "task_notification",
		},
	),
	assistant("a-t6", [text(PROSE)]),
	{
		type: "system",
		subtype: "compact_boundary",
		content: "Conversation compacted",
		uuid: "s-compact",
		timestamp: "2026-11-01T00:00:00Z",
		compactMetadata:
		{
			trigger: "manual",
			preTokens: 120_000,
			postTokens: 20_000,
		},
	},
	user(
		"c-1",
		"Fabricated compact summary",
		{
			isCompactSummary: true,
		},
	),
];

function renderTranscript(): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(RECORDS);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			transcriptMode="normal"
			showTools
			showThinking={false}
			shouldScrollToEnd={false}
		/>,
	).container;
}

/** Status rows and tool rows the in-app find walker would still enter. */
function unmarkedRows(container: HTMLElement): (string | null)[]
{
	return [...container.querySelectorAll("[data-turn-status],[data-tool-row]")]
		.filter((row) => row.closest("[data-find-omitted]") === null)
		.map((row) => row.textContent);
}

describe("transcript TurnStatus rows carry upstream's data-find-omitted", () =>
{
	it("marks every tool, group, agent, background-run and compaction row, and includes nothing back", () =>
	{
		const container = renderTranscript();

		expect(
			{
				unmarked: unmarkedRows(container),
				included: container.querySelectorAll("[data-find-included]").length,
				statusRows: container.querySelectorAll("[data-turn-status]").length > 4,
			},
		).toStrictEqual(
			{
				unmarked: [],
				included: 0,
				statusRows: true,
			},
		);
	});

	it("keeps an expanded Bash body inside the omitted root, so find skips it while prose stays findable", async () =>
	{
		const container = renderTranscript();
		const toggle = [...container.querySelectorAll<HTMLElement>("[data-standalone-tool-row] [aria-expanded]")].find(
			(button) => button.textContent.includes("Printed the word"),
		);
		if (toggle === undefined) throw new Error("no lone Bash toggle");
		fireEvent.click(toggle);
		const stdout = await screen.findByText(
			STDOUT,
			{
				exact: false,
			},
		);

		expect(
			{
				bodyOmitted: stdout.closest("[data-find-omitted]") !== null,
				stdout: collectFindRanges(container, "zephyr").map((range) => range.toString()),
				label: collectFindRanges(container, "Printed the word").map((range) => range.toString()),
				group: collectFindRanges(container, "Ran 2 commands").map((range) => range.toString()),
				prose: collectFindRanges(container, "quokkas").map((range) => range.toString()),
			},
		).toStrictEqual(
			{
				bodyOmitted: true,
				stdout: [],
				label: [],
				group: [],
				prose: ["quokkas"],
			},
		);
	});
});
