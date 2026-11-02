// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SendingUserRow} from "../src/components/pending-user-row";
import {SessionChat} from "../src/components/session-chat";
import {StreamingMessage} from "../src/components/streaming-message";
import {WaitingUserTurn} from "../src/components/waiting-user-turn";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/lib/shrinkwrap", async (importOriginal) => (
{
	...(await importOriginal<typeof import("../src/lib/shrinkwrap")>()),
	attachShrinkwrap: (el: HTMLElement) =>
	{
		queueMicrotask(() =>
		{
			el.style.maxWidth = "400px";
		});
		return () =>
		{
			el.style.maxWidth = "";
		};
	},
}));
vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug: true,
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
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
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
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[]): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

async function bubbleStyle(container: HTMLElement): Promise<string | null>
{
	await act(async () => {});
	return container.querySelector(".user-message-bubble")?.getAttribute("style") ?? null;
}

describe("every user bubble shrinkwraps (upstream UserMessage an())", () =>
{
	it("writes the fitted inline max-width on plain, command, compaction, waiting, sending and streaming bubbles", async () =>
	{
		const rows: Record<string, string | null> = {};
		rows["plain"] = await bubbleStyle(
			renderRecords([
				{
					type: "user",
					uuid: "u",
					message:
					{
						role: "user",
						content: "hello there",
					},
				},
			]),
		);
		cleanup();
		rows["command"] = await bubbleStyle(
			renderRecords([
				{
					type: "user",
					uuid: "c",
					message:
					{
						role: "user",
						content: "<command-name>/loop</command-name>",
					},
				},
			]),
		);
		cleanup();
		rows["compaction"] = await bubbleStyle(
			renderRecords([
				{
					type: "user",
					uuid: "s",
					isCompactSummary: true,
					message:
					{
						role: "user",
						content: "This session is being continued from a previous conversation.",
					},
				},
			]),
		);
		cleanup();
		rows["waiting"] = await bubbleStyle(render(<WaitingUserTurn entryId="w" text="hi" head />).container);
		cleanup();
		rows["sending"] = await bubbleStyle(render(<SendingUserRow prompt="hi" />).container);
		cleanup();
		rows["streaming"] = await bubbleStyle(
			render(<StreamingMessage text="" isComplete={false} sentPrompt="hi" />).container,
		);
		expect(rows).toEqual(
			{
				plain: "max-width: 400px;",
				command: "max-width: 400px;",
				compaction: "max-width: 400px;",
				waiting: "max-width: 400px;",
				sending: "max-width: 400px;",
				streaming: "max-width: 400px;",
			},
		);
	});

	it("keeps the debug link absolute so the fit skips it", async () =>
	{
		const container = renderRecords([
			{
				type: "user",
				uuid: "c",
				message:
				{
					role: "user",
					content: "<command-name>/loop</command-name>",
				},
			},
		]);
		await act(async () => {});
		const debug = [...container.querySelectorAll(".user-message-bubble > *")].filter((el) =>
			el.classList.contains("absolute"),
		);
		expect(debug.length).toBe(1);
	});
});
