// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Context7Renderer} from "../src/components/tool-renderers/context7-renderer";
import {GrepRenderer} from "../src/components/tool-renderers/grep-renderer";
import {GlobRenderer} from "../src/components/tool-renderers/glob-renderer";
import {McpRenderer} from "../src/components/tool-renderers/mcp-renderer";
import {ToolAwaitingResultContext} from "../src/components/tool-renderers/tool-awaiting-result-context";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

vi.mock("../src/hooks/use-shiki", () => (
{
	useHighlightedLines: () => null,
	getHighlighterSync: () => null,
	getHighlighterVersion: () => 0,
	subscribeHighlighter: () => () =>
	{
	},
}));

const writeText = vi.fn<(text: string) => Promise<void>>(async () => Promise.resolve());
Object.defineProperty(
	navigator,
	"clipboard",
	{
		value:
		{
			writeText,
		},
		configurable: true,
	},
);

afterEach(() =>
{
	cleanup();
	writeText.mockClear();
});

const TOLD =
	"Error: result (75,442 characters across 1,903 lines) exceeds maximum allowed tokens. Output has been saved to /x/tool-results/mcp-1.txt.\nFormat: Plain text";

function call(name: string, input: Record<string, unknown>, extra: Partial<ClientToolCall> = {}): ClientToolCall
{
	return {
		id: "tool-call-1",
		name,
		input,
		param: "",
		sourceUuid: "source-1",
		...extra,
	};
}

function copiedText(): string | undefined
{
	fireEvent.click(
		screen.getByRole(
			"button",
			{
				name: "Copy",
			},
		),
	);
	return writeText.mock.calls[0]?.[0];
}

describe("KeyValueCard Input/Output sections (upstream qx / Xx / tS)", () =>
{
	it("labels a Grep card's Input and Output, rules between them and clamps the input to max-h-40", () =>
	{
		const {container} = render(
			<GrepRenderer
				toolCall={call(
					"Grep",
					{
						pattern: "alice",
					},
					{
						result: "a.ts",
					},
				)}
			/>,
		);
		const labels = [...container.querySelectorAll(".text-footnote.text-muted-as-secondary[data-find-omitted]")];
		const input = container.querySelector<HTMLElement>('[aria-label="Tool call input"]');
		expect(
			{
				labels: labels.map((label) => label.textContent),
				rules: container.querySelectorAll(".border-t").length,
				input: [input?.getAttribute("role"), input?.tabIndex, input?.className, input?.textContent],
				stack: container.querySelector('[aria-label="Tool call input"]')?.closest(".gap-sm")?.className,
				copy: copiedText(),
			},
		).toStrictEqual(
			{
				labels: ["Input", "Output"],
				rules: 1,
				input: ["group", 0, "max-h-40 overflow-y-auto", "pattern: alice"],
				stack: "flex flex-col gap-sm",
				copy: "pattern: alice\n\na.ts",
			},
		);
	});

	it("shows a no-param card's output bare, with no label or rule", () =>
	{
		const {container} = render(
			<McpRenderer
				toolCall={call(
					"mcp__x__y",
					{},
					{
						result: "done",
					},
				)}
			/>,
		);
		expect(
			{
				labels: container.querySelectorAll("[data-find-omitted]").length,
				rules: container.querySelectorAll(".border-t").length,
				output: container.querySelector('[aria-label="Tool output"]')?.textContent,
			},
		).toStrictEqual(
			{
				labels: 0,
				rules: 0,
				output: "done",
			},
		);
	});

	it("draws a saved MCP result as the note and closed fold, and copies the input plus the full told-Claude text", () =>
	{
		const {container} = render(
			<McpRenderer
				toolCall={call(
					"mcp__gmail__search",
					{
						query: "x",
					},
					{
						result: TOLD,
						outputShape:
						{
							note:
							{
								kind: "saved",
								path: "/x/tool-results/mcp-1.txt",
							},
							toldClaude: TOLD,
						},
					},
				)}
			/>,
		);
		const visibleBefore = container.textContent.includes("exceeds maximum allowed tokens");
		const copy = copiedText();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Details for Claude",
				},
			),
		);
		expect(
			{
				visibleBefore,
				note: container.querySelector(".text-footnote[data-find-omitted] > span")?.textContent,
				visibleAfter: container.textContent.includes("exceeds maximum allowed tokens"),
				copy,
			},
		).toStrictEqual(
			{
				visibleBefore: false,
				note: "mcp-1.txt",
				visibleAfter: true,
				copy: `query: x\n\n${TOLD}`,
			},
		);
	});

	it("says No output with no copy button for an empty paramless Glob", () =>
	{
		const {container} = render(
			<GlobRenderer
				toolCall={call(
					"Glob",
					{},
					{
						result: "(Glob completed with no output)",
						outputShape:
						{
							status: "empty",
						},
					},
				)}
			/>,
		);
		expect(
			{
				text: container.textContent,
				copy: screen.queryByRole(
					"button",
					{
						name: "Copy",
					},
				),
			},
		).toStrictEqual(
			{
				text: "No output",
				copy: null,
			},
		);
	});

	it("says Waiting for the result under Output for a call awaiting its result, copying just the input", () =>
	{
		const {container} = render(
			<ToolAwaitingResultContext value>
				<GrepRenderer
					toolCall={call(
						"Grep",
						{
							pattern: "p",
						},
					)}
				/>
			</ToolAwaitingResultContext>,
		);
		expect(
			{
				labels: [...container.querySelectorAll(".text-footnote[data-find-omitted]")].map((l) => l.textContent),
				waiting: container.querySelector("div.text-muted-as-secondary[data-find-omitted]:not(.text-footnote)")
					?.textContent,
				copy: copiedText(),
			},
		).toStrictEqual(
			{
				labels: ["Input", "Output"],
				waiting: "Waiting for the result",
				copy: "pattern: p",
			},
		);
	});

	it("shows no output section for a call without a result that is not awaiting one (upstream xu gate)", () =>
	{
		const {container} = render(
			<GrepRenderer
				toolCall={call(
					"Grep",
					{
						pattern: "p",
					},
				)}
			/>,
		);
		expect(
			{
				text: container.textContent,
				labels: [...container.querySelectorAll(".text-footnote[data-find-omitted]")].map((l) => l.textContent),
			},
		).toStrictEqual(
			{
				text: "Inputpattern: p",
				labels: ["Input"],
			},
		);
	});

	it("draws nothing for a paramless call awaiting its result (upstream ym)", () =>
	{
		const {container} = render(
			<ToolAwaitingResultContext value>
				<McpRenderer toolCall={call("mcp__x__y", {})} />
			</ToolAwaitingResultContext>,
		);
		expect(container.innerHTML).toBe("");
	});

	it("copies the whole output for a preview, not just the preview body", () =>
	{
		const output =
			"Output too large (74.1KB). Full output saved to: /x/tool-results/a.txt\n\nPreview (first 2KB):\nline1";
		render(
			<GrepRenderer
				toolCall={call(
					"Grep",
					{
						pattern: "p",
					},
					{
						result: output,
						outputShape:
						{
							note:
							{
								kind: "preview",
								path: "/x/tool-results/a.txt",
							},
							body: "line1",
						},
					},
				)}
			/>,
		);
		expect(copiedText()).toBe(`pattern: p\n\n${output}`);
	});
});

describe("KeyValueCard body kinds (upstream aS / o_)", () =>
{
	it("tiles an MCP JSON result, prefers the transcript's full pretty JSON, and copies the pretty text", () =>
	{
		const {container} = render(
			<McpRenderer
				toolCall={call(
					"mcp__db__q",
					{
						x: "1",
					},
					{
						result: '{"ok":true}',
					},
				)}
			/>,
		);
		const tile = container.querySelector(".epitaxy-code-card");
		const copy = copiedText();
		cleanup();
		const cut = render(
			<McpRenderer
				toolCall={call(
					"mcp__db__q",
					{},
					{
						result: '{"ok":\n... (1 more lines)',
						resultJson: '{\n  "ok": true\n}',
					},
				)}
			/>,
		).container;
		expect(
			{
				tile: tile?.textContent,
				copy,
				cut: cut.querySelector(".epitaxy-code-card")?.textContent,
			},
		).toStrictEqual(
			{
				tile: '{\n  "ok": true\n}',
				copy: 'x: 1\n\n{\n  "ok": true\n}',
				cut: '{\n  "ok": true\n}',
			},
		);
	});

	it("never renders Grep output as markdown", () =>
	{
		const {container} = render(
			<GrepRenderer
				toolCall={call(
					"Grep",
					{
						pattern: "x",
					},
					{
						result: "a **x** b",
					},
				)}
			/>,
		);
		expect(container.querySelector("strong")).toBeNull();
	});

	it("renders context7 markdown in the Tool output body, not an ad-hoc text-xs wrapper", () =>
	{
		const {container} = render(
			<Context7Renderer
				toolCall={call(
					"mcp__context7__get-library-docs",
					{
						id: "x",
					},
					{
						result: "## Docs\n- a",
					},
				)}
			/>,
		);
		expect(
			{
				heading: container.querySelector('[aria-label="Tool output"] > div.whitespace-normal h2')?.textContent,
				adHoc: container.querySelector(".text-xs.text-primary"),
			},
		).toStrictEqual(
			{
				heading: "Docs",
				adHoc: null,
			},
		);
	});
});
