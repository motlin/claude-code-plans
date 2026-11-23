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
	prose: Record<string, string | undefined> | null;
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
	return [...container.querySelectorAll<HTMLElement>("[data-testid=transcript-row]")].map((row) =>
	{
		const article = row.querySelector<HTMLElement>("article");
		return {
			kind: row.dataset["perfRow"],
			replyType: row.getAttribute("data-cds-reply-type"),
			prose:
				article === null
					? null
					: Object.fromEntries(Object.entries(article.dataset).filter(([key]) => key.startsWith("prose"))),
		};
	});
}

const REPLY_PROSE =
{
	proseFont: "sans",
	proseHeadingSize: "sm",
	proseTables: "flat",
};

describe("assistant reply prose carries upstream's flat Prose attributes (cds-type-experiment-gate live check, 2026-11-21)", () =>
{
	it("marks the assistant reply's markdown root, never the row or the user prompt", () =>
	{
		expect(rowMarkers()).toStrictEqual([
			{
				kind: "human",
				replyType: null,
				prose: null,
			},
			{
				kind: "assistant_text",
				replyType: null,
				prose: REPLY_PROSE,
			},
		]);
	});

	it("marks the reply prose the same with type off (upstream retired the gate)", () =>
	{
		expect(rowMarkers(["color", "panels"])).toStrictEqual([
			{
				kind: "human",
				replyType: null,
				prose: null,
			},
			{
				kind: "assistant_text",
				replyType: null,
				prose: REPLY_PROSE,
			},
		]);
	});
});
