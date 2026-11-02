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

const prompt =
{
	type: "user",
	uuid: "u-prompt",
	message:
	{
		role: "user",
		content: "Fabricated request",
	},
};

interface Call
{
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
}

/** One assistant message making every call, then each call's result. */
function turn(calls: Call[]): unknown[]
{
	return [
		prompt,
		{
			type: "assistant",
			uuid: "a1",
			message:
			{
				id: "msg-1",
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

function draw(calls: Call[]): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(turn(calls));
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

const edit = (id: string, oldString: string, newString: string, extra: Partial<Call> = {}): Call => (
{
	id,
	name: "Edit",
	input:
	{
		file_path: "/repo/a.ts",
		old_string: oldString,
		new_string: newString,
	},
	result: "The file has been updated.",
	...extra,
});

const read = (id: string, path: string, range: Record<string, number> = {}): Call => (
{
	id,
	name: "Read",
	input:
	{
		file_path: path,
		...range,
	},
	result: "1\tx",
});

/** Waits for every stacked body's lazy renderer, so none loads after the test tears down. */
async function bodiesLoaded(root: Element | null | undefined): Promise<void>
{
	await waitFor(() =>
	{
		const steps = [...(root?.querySelectorAll("[data-step-key]") ?? [])];
		expect(steps.every((step) => (step.firstElementChild?.querySelector("*") ?? null) !== null)).toBe(true);
	});
}

function headers(container: HTMLElement): (string | null)[]
{
	return [...container.querySelectorAll('[data-tool-row] > [role="button"], [data-tool-row] > button')].map(
		(row) => row.textContent,
	);
}

describe("same-target run row", () =>
{
	it("draws two Edits of one file as one row whose body stacks each call's body", async () =>
	{
		const container = draw([edit("e1", "a", "b\nc"), edit("e2", "d", "e\nf\ng")]);
		const closed =
		{
			groupToggles: container.querySelectorAll("button[aria-expanded]").length,
			headers: headers(container),
			anchor: container.querySelector("[data-tool-anchor]")?.getAttribute("data-tool-anchor"),
		};
		const toggle = container.querySelector<HTMLElement>("[data-cds-row-toggle]");
		if (toggle === null) throw new Error("no row toggle");
		fireEvent.click(toggle);
		const panel = container.querySelector("[data-cds-row-panel]");
		await bodiesLoaded(panel);

		expect(
			{
				closed,
				steps: [...(panel?.querySelectorAll("[data-step-key]") ?? [])].map((step) =>
					step.getAttribute("data-step-key"),
				),
				stepsClass: panel?.querySelector("[data-step-key]")?.parentElement?.className,
				nestedRows: panel?.querySelectorAll("[data-tool-row]").length,
			},
		).toStrictEqual(
			{
				closed:
				{
					groupToggles: 0,
					headers: ["Editeda.ts+5−25 added, 2 removed"],
					anchor: "e1 e2",
				},
				steps: ["e1", "e2"],
				stepsClass: "flex min-w-0 flex-col gap-sm",
				nestedRows: 0,
			},
		);
	});

	it("merges the ranges of repeated Reads of one file", () =>
	{
		const container = draw([
			read(
				"r1",
				"/repo/a.ts",
				{
					offset: 1,
					limit: 20,
				},
			),
			read(
				"r2",
				"/repo/a.ts",
				{
					offset: 40,
					limit: 21,
				},
			),
		]);
		expect(
			{
				headers: headers(container),
				range: container.querySelector('[id$="-range"]')?.textContent,
			},
		).toStrictEqual(
			{
				headers: ["Reada.ts(1–20, 40–60)"],
				range: "(1–20, 40–60)",
			},
		);
	});

	it("takes the run's outcome from its last call", () =>
	{
		const outcome = (calls: Call[]) =>
		{
			const container = draw(calls);
			const text = container.querySelector('[id$="-outcome"]')?.textContent ?? null;
			cleanup();
			return text;
		};
		expect(
			{
				lastFailed: outcome([
					edit("e1", "a", "b"),
					edit(
						"e2",
						"c",
						"d",
						{
							isError: true,
							result: "boom",
						},
					),
				]),
				firstFailed: outcome([
					edit(
						"e1",
						"a",
						"b",
						{
							isError: true,
							result: "boom",
						},
					),
					edit("e2", "c", "d"),
				]),
			},
		).toStrictEqual(
			{
				lastFailed: "Failed",
				firstFailed: null,
			},
		);
	});

	it("folds a same-target stretch inside a mixed group into one nested step", async () =>
	{
		const container = draw([
			{
				id: "b1",
				name: "Bash",
				input:
				{
					command: "ls",
				},
			},
			edit("e1", "a", "b\nc"),
			edit("e2", "d", "e\nf\ng"),
			read("r1", "/repo/b.ts"),
		]);
		const groupToggle = container.querySelector<HTMLElement>("button[aria-expanded]");
		if (groupToggle === null) throw new Error("no group toggle");
		fireEvent.click(groupToggle);
		const nested = [...container.querySelectorAll("[data-cds-row-panel] [data-tool-row]")];
		const editRow = nested[1];
		const editToggle = editRow?.querySelector<HTMLElement>('[role="button"]');
		if (editToggle === undefined || editToggle === null) throw new Error("no edit toggle");
		fireEvent.click(editToggle);
		await bodiesLoaded(editRow);

		expect(
			{
				labels: nested.map((row) => row.querySelector('[id$="-label"]')?.textContent),
				editStats: editRow?.querySelector('[role="button"]')?.textContent,
				editSteps: [...(editRow?.querySelectorAll("[data-step-key]") ?? [])].map((step) =>
					step.getAttribute("data-step-key"),
				),
			},
		).toStrictEqual(
			{
				labels: ["ls", "Edited a.ts", "Read b.ts"],
				editStats: "Edited a.ts+5−25 added, 2 removed",
				editSteps: ["e1", "e2"],
			},
		);
	});
});
