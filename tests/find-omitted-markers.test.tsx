// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
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

const RECORDS: unknown[] = [
	user("u-1", "Fabricated request"),
	assistant("a-t0", [text("Fabricated plan:\n\n```sh\necho zephyr\n```")]),
	...call(
		"toolu_bash",
		"Bash",
		{
			command: "echo zephyr",
			description: "Print the word",
		},
		"zephyr",
	),
	...call(
		"toolu_todo",
		"TodoWrite",
		{
			todos: [
				{
					content: "Fabricated done item",
					status: "completed",
					activeForm: "Doing it",
				},
				{
					content: "Fabricated running item",
					status: "in_progress",
					activeForm: "Running it",
				},
				{
					content: "Fabricated pending item",
					status: "pending",
					activeForm: "Pending it",
				},
			],
		},
		"Todos updated",
	),
	assistant("a-t1", [text("Fabricated reply about quokkas")]),
];

/** Renders the transcript with every disclosure opened, so the tool bodies mount. */
function renderTranscript(): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(RECORDS);
	const {container} = render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			transcriptMode="verbose"
			showTools
			showThinking={false}
			shouldScrollToEnd={false}
		/>,
	);
	for (let pass = 0; pass < 5; pass++)
	{
		const closed = [...container.querySelectorAll<HTMLElement>("[data-cds-row][aria-expanded=false]")];
		if (closed.length === 0) break;
		for (const button of closed) fireEvent.click(button);
	}
	return container;
}

/**
 * Screen-reader-only nodes (`.sr-only`, including empty live regions that fill in later) and
 * aria-hidden visual copy with text that sit outside every `[data-find-omitted]` subtree, so the
 * in-app Find walker would enter them.
 */
/**
 * Upstream (claude.ai/code live 2026-11-21) leaves message actions' sr-only reveal button and
 * empty copy-status live region unmarked; only the tail-actions slot the last bar portals into is
 * omitted. Mirror that rather than marking them.
 */
const UPSTREAM_UNMARKED =
	'button.sr-only[aria-label^="Show message actions for"], [data-cds=MessageActions] [role=status]';

function unmarkedHiddenCopy(container: HTMLElement): string[]
{
	return [...container.querySelectorAll(".sr-only, [aria-hidden=true]")]
		.filter(
			(element) =>
				!element.matches(UPSTREAM_UNMARKED) &&
				(element.classList.contains("sr-only") || element.textContent.trim() !== "") &&
				element.closest("[data-find-omitted]") === null,
		)
		.map(
			(element) =>
				`${element.tagName.toLowerCase()}: ${element.getAttribute("aria-label") ?? element.textContent.trim()}`,
		);
}

describe("transcript hidden copy carries upstream's data-find-omitted", () =>
{
	it("leaves no sr-only or aria-hidden text findable in a prose, code, Bash and checklist turn", () =>
	{
		expect(unmarkedHiddenCopy(renderTranscript())).toStrictEqual([]);
	});
});
