// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
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
	takeRecords()
	{
		return [];
	}
}

beforeEach(() =>
{
	vi.useFakeTimers(
		{
			toFake: ["setTimeout", "clearTimeout", "performance"],
		},
	);
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("innerHeight", 10_000);
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
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const PROMPT =
{
	type: "user",
	uuid: "user-1",
	message:
	{
		role: "user",
		content: "Inspect the services",
	},
};

/** One assistant message whose Bash calls are `[id, description]`; ids in `done` have results. */
function records(calls: readonly (readonly [string, string])[], done: readonly string[]): unknown[]
{
	return [
		PROMPT,
		{
			type: "assistant",
			uuid: "assistant-1",
			message:
			{
				role: "assistant",
				content: calls.map(([id, description]) => (
				{
					type: "tool_use",
					id,
					name: "Bash",
					input:
					{
						command: `echo ${id}`,
						description,
					},
				})),
			},
		},
		...done.map((id) => (
		{
			type: "user",
			uuid: `result-${id}`,
			message:
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						content: "ok",
					},
				],
			},
		})),
	];
}

function chat(recs: unknown[])
{
	const {lines, toolResultMap} = processTranscript(recs);
	return (
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>
	);
}

function advance(ms: number): void
{
	act(() =>
	{
		vi.advanceTimersByTime(ms);
	});
}

/** The key of every label slot's showing face, in document order. */
function shownKeys(root: Element): string[]
{
	return [...root.querySelectorAll<HTMLElement>("[data-morph-key]:not([aria-hidden])")].map(
		(face) => face.dataset["morphKey"] ?? "",
	);
}

const ALPHA = ["tuA", "Inspect alpha"] as const;
const BRAVO = ["tuB", "Inspect bravo"] as const;
const CHARLIE = ["tuC", "Inspect charlie"] as const;
const DELTA = ["tuD", "Inspect delta"] as const;

describe("a group header holds its running label (upstream gR: Gh 2s, settle 250ms)", () =>
{
	it("settles the first busy change, holds the next until 2s after the shown label, and settles done at once", () =>
	{
		const {container, rerender} = render(chat(records([ALPHA, BRAVO], ["tuA"])));
		const header = () => shownKeys(container.querySelector("button[aria-expanded]") ?? container);
		const mounted = header();

		rerender(chat(records([ALPHA, BRAVO, CHARLIE], ["tuA", "tuB"])));
		advance(249);
		const settling = header();
		advance(1);
		const settled = header();

		advance(50);
		rerender(chat(records([ALPHA, BRAVO, CHARLIE, DELTA], ["tuA", "tuB", "tuC"])));
		advance(1949);
		const held = header();
		advance(1);
		const released = header();

		rerender(chat(records([ALPHA, BRAVO, CHARLIE, DELTA], ["tuA", "tuB", "tuC", "tuD"])));
		const done = header();

		expect(
			{
				mounted,
				settling,
				settled,
				held,
				released,
				done,
			},
		).toStrictEqual(
			{
				mounted: ["busy|Inspecting bravo"],
				settling: ["busy|Inspecting bravo"],
				settled: ["busy|Inspecting charlie"],
				held: ["busy|Inspecting charlie"],
				released: ["busy|Inspecting delta"],
				done: ["done|"],
			},
		);
	});
});

describe("a standalone row holds busy relabels (upstream gR leaf: 650ms, settle 250ms)", () =>
{
	it("settles the first relabel, holds the next until 650ms after it showed, and settles done at once", () =>
	{
		const {container, rerender} = render(chat(records([ALPHA], [])));
		const mounted = shownKeys(container);

		rerender(chat(records([["tuA", "Inspect alpha twice"]], [])));
		advance(249);
		const settling = shownKeys(container);
		advance(1);
		const settled = shownKeys(container);

		rerender(chat(records([["tuA", "Inspect alpha thrice"]], [])));
		advance(649);
		const held = shownKeys(container);
		advance(1);
		const released = shownKeys(container);

		rerender(chat(records([["tuA", "Inspect alpha thrice"]], ["tuA"])));
		const done = shownKeys(container);

		expect(
			{
				mounted,
				settling,
				settled,
				held,
				released,
				done,
			},
		).toStrictEqual(
			{
				mounted: ["busy|Inspecting alpha"],
				settling: ["busy|Inspecting alpha"],
				settled: ["busy|Inspecting alpha twice"],
				held: ["busy|Inspecting alpha twice"],
				released: ["busy|Inspecting alpha thrice"],
				done: ["done|Inspected alpha thrice"],
			},
		);
	});
});

describe("a step row holds busy for 650ms after its first change (upstream wr)", () =>
{
	const openSteps = (container: HTMLElement) =>
	{
		const toggle = container.querySelector<HTMLElement>("button[aria-expanded]");
		if (toggle === null) throw new Error("no group toggle");
		fireEvent.click(toggle);
		const body = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
		if (body === null) throw new Error("no group body");
		return () => shownKeys(body);
	};

	it("swaps a step that mounted busy to done in the same render", () =>
	{
		const {container, rerender} = render(chat(records([ALPHA, BRAVO], ["tuA"])));
		const steps = openSteps(container);
		const busy = steps();
		rerender(chat(records([ALPHA, BRAVO], ["tuA", "tuB"])));
		expect([busy, steps()]).toStrictEqual([
			["done|Inspected alpha", "busy|Inspecting bravo"],
			["done|Inspected alpha", "done|Inspected bravo"],
		]);
	});

	it("relabels at once, then keeps the busy label until 650ms after the relabel showed", () =>
	{
		const {container, rerender} = render(chat(records([ALPHA, BRAVO], ["tuA"])));
		const steps = openSteps(container);
		rerender(chat(records([ALPHA, ["tuB", "Inspect bravo again"]], ["tuA"])));
		const relabelled = steps();
		advance(100);
		rerender(chat(records([ALPHA, ["tuB", "Inspect bravo again"]], ["tuA", "tuB"])));
		advance(549);
		const held = steps();
		advance(1);
		expect([relabelled, held, steps()]).toStrictEqual([
			["done|Inspected alpha", "busy|Inspecting bravo again"],
			["done|Inspected alpha", "busy|Inspecting bravo again"],
			["done|Inspected alpha", "done|Inspected bravo again"],
		]);
	});
});
