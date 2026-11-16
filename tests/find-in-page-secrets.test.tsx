// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
import {endFind, type FindResult, runFind as runStoreFind} from "../src/lib/find-in-page/store";
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

class FakeHighlight extends Set<Range>
{
	priority = 0;
}

/** A fake token built at runtime: the kept prefix shows `ghp_AAAA`, the hidden tail is all `Q`s. */
const TOKEN = `ghp_${"A".repeat(4)}${"Q".repeat(32)}`;
/** Only in the hidden tail: the masked DOM never shows it. */
const TAIL_QUERY = "AQQ";

function records(): unknown[]
{
	return [
		{
			type: "user",
			uuid: "u-1",
			message:
			{
				role: "user",
				content: "Fabricated request",
			},
		},
		{
			type: "assistant",
			uuid: "a-1",
			message:
			{
				id: "msg-a-1",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_env",
						name: "Bash",
						input:
						{
							command: "printenv GH",
							description: "Print the token",
						},
					},
				],
			},
		},
		{
			type: "user",
			uuid: "r-1",
			message:
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_env",
						content: `GH=${TOKEN}`,
					},
				],
			},
		},
		{
			type: "assistant",
			uuid: "a-2",
			message:
			{
				id: "msg-a-2",
				role: "assistant",
				content: [
					{
						type: "text",
						text: `Exported \`${TOKEN}\` as GH.`,
					},
				],
			},
		},
	];
}

function runFind(query: string): FindResult
{
	let result: FindResult | undefined;
	act(() =>
	{
		result = runStoreFind(query, true, true);
	});
	if (result === undefined) throw new Error("no result");
	return result;
}

async function settle(): Promise<void>
{
	await act(async () =>
	{
		await vi.runAllTimersAsync();
	});
}

describe("in-app Find over masked secrets in the transcript", () =>
{
	let registry: Map<string, FakeHighlight>;

	beforeEach(() =>
	{
		registry = new Map();
		vi.stubGlobal("Highlight", FakeHighlight);
		vi.stubGlobal(
			"CSS",
			{
				highlights: registry,
			},
		);
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("innerHeight", 4000);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
			setTimeout(() =>
			{
				callback(0);
			}, 0),
		);
		vi.stubGlobal("cancelAnimationFrame", (id: number) =>
		{
			clearTimeout(id);
		});
		vi.useFakeTimers();
		Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
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
		Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
		Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
		endFind();
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	function renderTranscript(): HTMLElement
	{
		const {lines, toolResultMap} = processTranscript(records());
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

	const activeText = () => [...(registry.get("find-in-page-active") ?? [])].map((range) => range.toString());

	it("counts the raw prose secret as upstream's unmasked search text does, but paints nothing active while it is masked", async () =>
	{
		renderTranscript();
		const tail = runFind(TAIL_QUERY);
		await settle();
		const tailActive = activeText();
		const bullets = runFind("•");
		const label = runFind("Redacted");
		expect(
			{
				tail: `${tail.activeIndex}/${tail.total}`,
				tailActive,
				bullets: bullets.total,
				label: label.total,
			},
		).toStrictEqual(
			{
				tail: "1/1",
				tailActive: [],
				bullets: 0,
				label: 0,
			},
		);
	});

	it("paints the raw value once its cloak is revealed, after the 60ms mutation recount", async () =>
	{
		const container = renderTranscript();
		runFind(TAIL_QUERY);
		await settle();
		const reveal = container.querySelector<HTMLElement>("[data-redacted-secret] button");
		if (reveal === null) throw new Error("no cloak in the prose");
		fireEvent.click(reveal);
		await act(async () =>
		{
			await vi.advanceTimersByTimeAsync(60);
		});
		await settle();
		expect(
			{
				pressed: reveal.getAttribute("aria-pressed"),
				active: activeText(),
			},
		).toStrictEqual(
			{
				pressed: "true",
				active: [TAIL_QUERY],
			},
		);
	});
});
