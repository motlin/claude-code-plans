// @vitest-environment jsdom

import {cleanup, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {type PaneHostApi, PaneHostContext} from "../src/components/panes/pane-host-context";
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
});
afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const prompt = (index: number) => (
{
	type: "user",
	uuid: `u-prompt-${index}`,
	message:
	{
		role: "user",
		content: `Fabricated request ${index}`,
	},
});

interface Call
{
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

/** A prompt, one assistant message making every call, then each call's result. */
function turn(calls: Call[], index: number): unknown[]
{
	return [
		prompt(index),
		{
			type: "assistant",
			uuid: `a${index}`,
			message:
			{
				id: `msg-${index}`,
				role: "assistant",
				content: calls.map(({id, name, input}) => (
				{
					type: "tool_use",
					id,
					name,
					input,
				})),
			},
		},
		...calls.map(({id, result, isError}) => (
		{
			type: "user",
			uuid: `r-${id}`,
			message:
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						content: result ?? "ok",
						...(isError === true
							?
								{
									is_error: true,
								}
							: {}),
					},
				],
			},
		})),
	];
}

const HOST =
{
	openPane: vi.fn<(kind: string) => void>(),
} as unknown as PaneHostApi;

/** Each call in its own turn, as a `/code-review` per prompt. */
function draw(calls: Call[]): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(calls.flatMap((call, index) => turn([call], index)));
	return render(
		<PaneHostContext.Provider value={HOST}>
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				transcriptMode="normal"
				showTools
				showThinking={false}
				shouldScrollToEnd={false}
			/>
		</PaneHostContext.Provider>,
	).container;
}

const FINDING =
{
	file: "src/a.ts",
	line: 4,
	summary: "Fake finding summary.",
	failure_scenario: "Fake failure scenario.",
	verdict: "CONFIRMED",
};

const review = (id: string, extra: Partial<Call> = {}, finding: Record<string, unknown> = FINDING): Call => (
{
	id,
	name: "ReportFindings",
	input:
	{
		level: "high",
		findings: [finding],
	},
	result: "Reported.",
	...extra,
});

function shown(container: HTMLElement)
{
	return {
		cards: [...container.querySelectorAll("[data-report-findings-card]")].map((card) =>
			[...card.querySelectorAll("button")]
				.map((button) => button.textContent)
				.filter((text) => text === "Walk through in Changes"),
		),
		rows: [...container.querySelectorAll("[data-tool-row]")].map((row) =>
			row.textContent.includes("Reported review findings"),
		),
	};
}

describe("Code review card in the transcript (upstream o && Ms(tool) -> iC)", () =>
{
	it("draws each settled review as a card, with header actions only on the latest", async () =>
	{
		const container = draw([review("r1"), review("r2")]);
		await waitFor(() =>
		{
			expect(container.querySelectorAll("[data-report-findings-card]").length).toBe(2);
		});

		expect(shown(container)).toStrictEqual(
			{
				cards: [[], ["Walk through in Changes"]],
				rows: [],
			},
		);
	});

	it("keeps the row for a failed review and for a fix report", async () =>
	{
		const container = draw([
			review(
				"r1",
				{
					isError: true,
					result: "Fake failure",
				},
			),
			review(
				"r2",
				{},
				{
					...FINDING,
					outcome: "fixed",
				},
			),
		]);
		await waitFor(() =>
		{
			expect(screen.getAllByText("Reported review findings").length).toBe(2);
		});

		expect(container.querySelectorAll("[data-report-findings-card]").length).toBe(0);
	});
});
