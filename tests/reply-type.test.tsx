// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";
import {processTranscript} from "../src/lib/transcript";

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
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

const RECORDS = [
	{
		type: "user",
		uuid: "u1",
		message:
		{
			role: "user",
			content: "Make a table",
		},
	},
	{
		type: "assistant",
		uuid: "a1",
		parentUuid: "u1",
		message:
		{
			role: "assistant",
			content: [
				{
					type: "text",
					text: "Here is **the** table.",
				},
			],
		},
	},
];

function rowMarkers(parts?: readonly FizzyLakePart[]):
{
	kind: string | undefined;
	replyType: string | null;
}[]
{
	const {lines, toolResultMap} = processTranscript(RECORDS);
	const chat = (
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
		/>
	);
	const {container} = render(
		parts === undefined ? chat : <FizzyLakeContext.Provider value={parts}>{chat}</FizzyLakeContext.Provider>,
	);
	return [...container.querySelectorAll<HTMLElement>("[data-testid=transcript-row]")].map((row) => (
	{
		kind: row.dataset["perfRow"],
		replyType: row.getAttribute("data-cds-reply-type"),
	}));
}

describe("assistant rows carry data-cds-reply-type under fizzy-lake type (cds-type-experiment-gate T4)", () =>
{
	it("marks the assistant row and never the user row", () =>
	{
		expect(rowMarkers()).toStrictEqual([
			{
				kind: "human",
				replyType: null,
			},
			{
				kind: "assistant_text",
				replyType: "",
			},
		]);
	});

	it("marks no row when type is off", () =>
	{
		expect(rowMarkers(["color", "panels"])).toStrictEqual([
			{
				kind: "human",
				replyType: null,
			},
			{
				kind: "assistant_text",
				replyType: null,
			},
		]);
	});
});

describe("tool rows inside a reply match the prose-size rule (cds-type-experiment-gate T7)", () =>
{
	it("puts the TurnStatus row's first child under the reply-type selector", () =>
	{
		const {lines, toolResultMap} = processTranscript([
			...RECORDS,
			{
				type: "assistant",
				uuid: "a2",
				parentUuid: "a1",
				message:
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "t1",
							name: "Bash",
							input:
							{
								command: "ls",
							},
						},
					],
				},
			},
			{
				type: "user",
				uuid: "r1",
				parentUuid: "a2",
				message:
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "t1",
							content: "ok",
							is_error: false,
						},
					],
				},
			},
		]);
		const {container} = render(
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				showCompactSummaries
				showTranscriptOnly
			/>,
		);
		const status = container.querySelector("[data-turn-status]")!;
		expect(
			{
				matches: status.firstElementChild?.matches(
					'[data-cds-reply-type] :is([data-turn-status], [data-cds="TurnStatus"]):not([data-cds-reply-type] [data-cds]:not([data-cds-reply-type]) *) > :first-child',
				),
				row: status.closest("[data-testid=transcript-row]")?.getAttribute("data-cds-reply-type"),
			},
		).toStrictEqual(
			{
				matches: true,
				row: "",
			},
		);
	});
});
