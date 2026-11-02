// @vitest-environment jsdom

import {cleanup, fireEvent, render, waitFor} from "@testing-library/react";
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
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[], permissionWaitToolUseId?: string): HTMLElement
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
			{...(permissionWaitToolUseId === undefined
				? {}
				:
					{
						permissionWaitToolUseId,
					})}
		/>,
	).container;
}

const RECORDS = [
	{
		type: "user",
		uuid: "user-1",
		message:
		{
			role: "user",
			content: "Open the PR",
		},
	},
	{
		type: "assistant",
		uuid: "assistant-1",
		message:
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "toolu_waiting",
					name: "Bash",
					input:
					{
						command: "gh pr create --draft",
						description: "Open draft PR for the AssertJ branch",
					},
				},
			],
		},
	},
];

describe("a call held at its permission prompt", () =>
{
	it("labels its row with the description as written, while a merely running call reads progressive", () =>
	{
		const waiting = renderRecords(RECORDS, "toolu_waiting").textContent;
		cleanup();
		const running = renderRecords(RECORDS).textContent;

		expect(
			{
				waiting: waiting.includes("Open draft PR for the AssertJ branch") && !waiting.includes("Opening"),
				running: running.includes("Opening draft PR for the AssertJ branch"),
			},
		).toStrictEqual(
			{
				waiting: true,
				running: true,
			},
		);
	});

	it("says Waiting for the result in an open generic body only while the call is not held (upstream xu)", async () =>
	{
		const grep = [
			RECORDS[0],
			{
				type: "assistant",
				uuid: "assistant-1",
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_grep",
							name: "Grep",
							input:
							{
								pattern: "alice",
							},
						},
					],
				},
			},
		];
		// Open the turn's step list, then the Grep row inside it.
		const openBody = async (container: HTMLElement) =>
		{
			for (let toggle = container.querySelector<HTMLElement>('[aria-expanded="false"]'); toggle !== null;)
			{
				fireEvent.click(toggle);
				toggle = container.querySelector<HTMLElement>('[aria-expanded="false"]');
			}
			// The renderer chunk loads lazily; the Input section shows once it has.
			await waitFor(() =>
			{
				expect(container.textContent).toContain("pattern: alice");
			});
			return container.textContent.includes("Waiting for the result");
		};
		const running = await openBody(renderRecords(grep));
		cleanup();
		const held = await openBody(renderRecords(grep, "toolu_grep"));
		expect(
			{
				running,
				held,
			},
		).toStrictEqual(
			{
				running: true,
				held: false,
			},
		);
	});
});
