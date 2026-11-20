// @vitest-environment jsdom

import {cleanup, fireEvent, render, render as renderRaw, waitFor} from "@testing-library/react";
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

function bashRecords(description: string)
{
	return [
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
							command: "git push",
							description,
						},
					},
				],
			},
		},
	];
}

const RECORDS = bashRecords("Push branches and open PRs");

describe("a call held at its permission prompt", () =>
{
	it("labels its row with the running label like any running call (upstream dockedWait is status running)", () =>
	{
		const waiting = renderRecords(RECORDS, "toolu_waiting").textContent;
		cleanup();
		const running = renderRecords(RECORDS).textContent;
		cleanup();
		const unknownWaiting = renderRecords(
			bashRecords("Open draft PR for the AssertJ branch"),
			"toolu_waiting",
		).textContent;

		expect(
			{
				waiting: waiting.includes("Pushing branches and open PRs"),
				running: running.includes("Pushing branches and open PRs"),
				unknownWaiting:
					unknownWaiting.includes("Open draft PR for the AssertJ branch") &&
					!unknownWaiting.includes("Opening"),
			},
		).toStrictEqual(
			{
				waiting: true,
				running: true,
				unknownWaiting: true,
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

describe("a lone call queued behind the head approval (upstream BC/tye)", () =>
{
	const bash = (id: string, description: string) => (
	{
		type: "tool_use",
		id,
		name: "Bash",
		input:
		{
			command: `echo ${id}`,
			description,
		},
	});
	const assistant = (uuid: string, content: unknown[]) => (
	{
		type: "assistant",
		uuid,
		message:
		{
			role: "assistant",
			content,
		},
	});
	const prose = (text: string) => (
	{
		type: "text",
		text,
	});
	const result = (id: string) => (
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
	});
	const stopHook =
	{
		type: "user",
		uuid: "stop-hook",
		isMeta: true,
		message:
		{
			role: "user",
			content: "Stop hook feedback:\nKeep going",
		},
	};
	const LONE = [
		RECORDS[0],
		assistant("a-1", [prose("First step."), bash("tuA", "Inspect alpha")]),
		assistant("a-2", [prose("Second step."), bash("tuB", "Inspect bravo")]),
	];
	const GROUP = [RECORDS[0], assistant("a-1", [bash("tuA", "Inspect alpha"), bash("tuB", "Inspect bravo")])];
	const render = (records: unknown[], queued: ReadonlySet<string>) =>
	{
		const {lines, toolResultMap} = processTranscript(records);
		const text = renderRaw(
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				shouldScrollToEnd={false}
				transcriptMode="normal"
				queuedCallIds={queued}
			/>,
		).container.textContent;
		cleanup();
		return {
			alpha: text.includes("alpha"),
			bravo: text.includes("bravo"),
			hookRow: text.includes("Hook re-prompted Claude"),
		};
	};
	const queuedB = new Set(["tuB"]);

	it("drops the queued lone row while it runs, keeps the head's, and keeps grouped or settled calls", () =>
	{
		expect(
			{
				queued: render(LONE, queuedB),
				settled: render([...LONE, result("tuB")], queuedB),
				grouped: render(GROUP, queuedB),
				groupedNone: render(GROUP, new Set()),
				none: render(LONE, new Set()),
			},
		).toStrictEqual(
			{
				queued:
				{
					alpha: true,
					bravo: false,
					hookRow: false,
				},
				settled:
				{
					alpha: true,
					bravo: true,
					hookRow: false,
				},
				// The group's summary names its latest step either way.
				grouped:
				{
					alpha: false,
					bravo: true,
					hookRow: false,
				},
				groupedNone:
				{
					alpha: false,
					bravo: true,
					hookRow: false,
				},
				none:
				{
					alpha: true,
					bravo: true,
					hookRow: false,
				},
			},
		);
	});

	it("draws a queued lone call's hook notice on its own, without the call's row (upstream u2 false)", () =>
	{
		const withHook = [
			RECORDS[0],
			assistant("a-1", [prose("First step.")]),
			stopHook,
			assistant("a-2", [bash("tuB", "Inspect bravo")]),
		];
		expect(
			{
				queued: render(withHook, queuedB),
				unqueued: render(withHook, new Set()),
			},
		).toStrictEqual(
			{
				queued:
				{
					alpha: false,
					bravo: false,
					hookRow: true,
				},
				// Unqueued, the notice folds into the call's collapsed group.
				unqueued:
				{
					alpha: false,
					bravo: true,
					hookRow: false,
				},
			},
		);
	});
});
