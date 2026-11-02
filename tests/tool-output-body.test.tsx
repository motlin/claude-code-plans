// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ToolOutputBody} from "../src/components/tool-renderers/tool-output-body";
import {CODE_THEME_BG_FALLBACK} from "../src/hooks/use-code-theme-background";
import {classifyToolBody} from "../src/lib/tool-body-kind";

vi.mock("../src/hooks/use-shiki", () => (
{
	useHighlightedLines: () => null,
	getHighlighterSync: () => null,
	getHighlighterVersion: () => 0,
	subscribeHighlighter: () => () =>
	{
	},
}));

afterEach(cleanup);

/** An obviously fake GitHub token: the prefix plus 36 repeated letter. */
const FAKE_GH = `ghp_${"A".repeat(36)}`;

function draw(text: string, allowMarkdown = true): HTMLElement
{
	return render(
		<ToolOutputBody
			body={classifyToolBody(
				text,
				{
					allowMarkdown,
				},
			)}
		/>,
	).container;
}

function region(container: HTMLElement): HTMLElement
{
	const found = container.querySelector<HTMLElement>('[role="group"][aria-label="Tool output"]');
	if (found === null) throw new Error("Missing Tool output region");
	return found;
}

describe("ToolOutputBody (upstream aS / oS)", () =>
{
	it("draws JSON pretty-printed in the code tile inside the 400px Tool output scroller", () =>
	{
		const container = draw('{"a":1}');
		const scroller = region(container);
		const wrap = scroller.firstElementChild;
		const tile = wrap?.firstElementChild;
		expect(
			{
				scroller: [scroller.className, scroller.tabIndex],
				wrap: wrap?.className,
				wrapDir: wrap?.getAttribute("dir"),
				tile: tile?.className,
				tileDir: tile?.getAttribute("dir"),
				background: (tile as HTMLElement | null | undefined)?.style.background,
				inner: tile?.firstElementChild?.className,
				text: tile?.textContent,
			},
		).toStrictEqual(
			{
				scroller: ["max-h-[400px] overflow-y-auto", 0],
				wrap: "p-px",
				wrapDir: null,
				tile: "epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code",
				tileDir: "ltr",
				// Upstream $c: the code theme's background (`Zr`), here before either theme has loaded.
				background: CODE_THEME_BG_FALLBACK,
				inner: "min-w-0 flex-1",
				text: '{\n  "a": 1\n}',
			},
		);
	});

	it("draws markdown in a whitespace-normal block with headings announced under level 3", () =>
	{
		const container = draw("## Docs\n- a\n\n| a | b |\n|---|---|\n| 1 | 2 |");
		const block = region(container).firstElementChild;
		expect(
			{
				block: block?.className,
				table: block?.querySelector("table") !== null,
				heading: [
					block?.querySelector("h2")?.getAttribute("aria-level"),
					block?.querySelector("h2")?.textContent,
				],
			},
		).toStrictEqual(
			{
				block: "whitespace-normal",
				table: true,
				heading: ["4", "Docs"],
			},
		);
	});

	it("keeps markdown plain when the tool disallows it", () =>
	{
		const container = draw("| a | b |\n|---|---|\n| 1 | 2 |", false);
		expect(container.querySelector("table")).toBeNull();
	});

	it("draws columns text and an untiled JSON body in text-code, other text bare, all linkified", () =>
	{
		const columns = region(draw("NAME  X\nfoo   y")).firstElementChild;
		const big = region(
			draw(
				JSON.stringify(
					Array.from(
						{
							length: 2000,
						},
						(_, i) => i,
					),
				),
			),
		).firstElementChild;
		const text = region(draw("see https://e.com/x")).firstElementChild;
		expect(
			{
				columns: columns?.className,
				big: [big?.className, big?.textContent.startsWith("[\n  0,\n")],
				text: [text?.getAttribute("class"), text?.querySelector("a")?.getAttribute("href")],
			},
		).toStrictEqual(
			{
				columns: "text-code",
				big: ["text-code", true],
				text: [null, "https://e.com/x"],
			},
		);
	});

	it("paints ANSI SGR runs in a plain body instead of showing the escape bytes, and links nothing inside them", () =>
	{
		const body = region(draw("\u001b[31mfailed\u001b[0m see https://e.com/x")).firstElementChild;
		const red = body?.querySelector<HTMLElement>("span[style]");
		expect(
			{
				text: body?.textContent,
				red: [red?.textContent, red?.style.color],
				links: body?.querySelectorAll("a").length,
			},
		).toStrictEqual(
			{
				text: "failed see https://e.com/x",
				red: ["failed", "rgb(204, 0, 0)"],
				links: 0,
			},
		);
	});

	it("cloaks a secret in a plain body behind its own reveal button (upstream cb557955f y)", () =>
	{
		const body = region(draw(`token ${FAKE_GH} and https://e.com/x`)).firstElementChild;
		const cloak = body?.querySelector("[data-redacted-secret]");
		const button = cloak?.querySelector("button");
		const shown = () => cloak?.querySelector(".break-all")?.textContent;
		const masked = shown();
		if (button) fireEvent.click(button);
		expect(
			{
				masked: masked?.includes(FAKE_GH),
				label: masked?.startsWith("Redacted GitHub token"),
				revealed: shown(),
				pressed: button?.getAttribute("aria-pressed"),
				buttonLabel: button?.getAttribute("aria-label"),
				link: body?.querySelector("a")?.getAttribute("href"),
			},
		).toStrictEqual(
			{
				masked: false,
				label: true,
				revealed: FAKE_GH,
				pressed: "true",
				buttonLabel: "Hide GitHub token",
				link: "https://e.com/x",
			},
		);
	});
});
