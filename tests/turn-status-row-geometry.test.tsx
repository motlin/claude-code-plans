// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {TURN_STATUS_ROW_GEOMETRY} from "../src/components/turn-status-row-geometry";
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

const PROMPT =
{
	type: "user",
	uuid: "u1",
	message:
	{
		role: "user",
		content: "List the files",
	},
};
const REPLY =
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
				text: "Listing them now.",
			},
		],
	},
};
const BASH_CALL =
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
					description: "List files",
				},
			},
		],
	},
};
const BASH_RESULT =
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
				content: "a.txt",
				is_error: false,
			},
		],
	},
};

function renderRecords(records: unknown[]): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
			shouldScrollToEnd={false}
		/>,
	).container;
}

function toolRow(container: HTMLElement): HTMLElement
{
	const row = container.querySelector<HTMLElement>("[data-turn-status-frame] [data-cds-row-toggle]");
	if (!row) throw new Error("Expected a TurnStatus tool row.");
	return row;
}

describe("assistant transcript rows are upstream's AssistantMessage (turn-status-row-hang-geometry T1)", () =>
{
	it("marks every assistant-side row data-cds=AssistantMessage and never the prompt", () =>
	{
		const container = renderRecords([PROMPT, REPLY, BASH_CALL, BASH_RESULT]);

		expect(
			[...container.querySelectorAll<HTMLElement>("[data-testid=transcript-row]")].map((row) => (
			{
				kind: row.dataset["perfRow"],
				cds: row.getAttribute("data-cds"),
			})),
		).toStrictEqual([
			{
				kind: "human",
				cds: null,
			},
			{
				kind: "assistant_text",
				cds: "AssistantMessage",
			},
			{
				kind: "assistant_tool",
				cds: "AssistantMessage",
			},
		]);
	});
});

describe("TurnStatus rows take upstream's qe geometry (turn-status-row-hang-geometry T2)", () =>
{
	it("exports upstream's qe row geometry classes", () =>
	{
		expect(TURN_STATUS_ROW_GEOMETRY).toBe(
			"w-stretch px-xs ms-[calc(var(--cds-assistant-message-text-inset,0px)_-_var(--cds-outset-x,0px)_-_var(--cds-turn-status-hang,0px))] me-[calc(var(--cds-assistant-message-text-stop,0px)_-_var(--cds-outset-x,0px))]",
		);
	});

	it("gives a done row the geometry, the JG outset style and no margin transition", () =>
	{
		const row = toolRow(renderRecords([PROMPT, BASH_CALL, BASH_RESULT]));
		const classes = row.className.split(" ");

		expect(
			{
				geometry: TURN_STATUS_ROW_GEOMETRY.split(" ").every((name) => classes.includes(name)),
				fixedEnd: classes.includes("me-[52px]"),
				fixedPad: classes.includes("px-1") || classes.includes("comfortable:px-1.5"),
				outset: row.style.getPropertyValue("--cds-outset-x"),
				transition: classes.includes("transition-[margin-inline-start]"),
			},
		).toStrictEqual(
			{
				geometry: true,
				fixedEnd: false,
				fixedPad: false,
				outset: "var(--cds-pad-xs)",
				transition: false,
			},
		);
	});

	it("animates a running (marked) row's start margin like upstream's busy row", () =>
	{
		const row = toolRow(renderRecords([PROMPT, BASH_CALL]));
		const classes = row.className.split(" ");

		expect(
			{
				geometry: TURN_STATUS_ROW_GEOMETRY.split(" ").every((name) => classes.includes(name)),
				outset: row.style.getPropertyValue("--cds-outset-x"),
				transition: [
					"transition-[margin-inline-start]",
					"duration-200",
					"ease-out",
					"motion-reduce:transition-none",
				].map((name) => classes.includes(name)),
			},
		).toStrictEqual(
			{
				geometry: true,
				outset: "var(--cds-pad-xs)",
				transition: [true, true, true, true],
			},
		);
	});
});
