// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ToolOutputBody} from "../src/components/tool-renderers/tool-output-body";
import {classifyToolBody} from "../src/lib/tool-body-kind";

vi.mock("../src/hooks/use-shiki", () => ({
	useHighlightedLines: () => null,
	getHighlighterSync: () => null,
	getHighlighterVersion: () => 0,
	subscribeHighlighter: () => () => {},
}));

afterEach(cleanup);

function draw(text: string, allowMarkdown = true): HTMLElement {
	return render(<ToolOutputBody body={classifyToolBody(text, {allowMarkdown})} />).container;
}

function region(container: HTMLElement): HTMLElement {
	const found = container.querySelector<HTMLElement>('[role="group"][aria-label="Tool output"]');
	if (found === null) throw new Error("Missing Tool output region");
	return found;
}

describe("ToolOutputBody (upstream aS / oS)", () => {
	it("draws JSON pretty-printed in the code tile inside the 400px Tool output scroller", () => {
		const container = draw('{"a":1}');
		const scroller = region(container);
		const wrap = scroller.firstElementChild;
		const tile = wrap?.firstElementChild;
		expect({
			scroller: [scroller.className, scroller.tabIndex],
			wrap: wrap?.className,
			tile: tile?.className,
			inner: tile?.firstElementChild?.className,
			text: tile?.textContent,
		}).toStrictEqual({
			scroller: ["max-h-[400px] overflow-y-auto", 0],
			wrap: "p-px",
			tile: "epitaxy-diff epitaxy-code-card rounded-lg flex overflow-clip px-md py-xs text-code bg-surface-1 dark:bg-surface-2",
			inner: "min-w-0 flex-1",
			text: '{\n  "a": 1\n}',
		});
	});

	it("draws markdown in a whitespace-normal block with headings announced under level 3", () => {
		const container = draw("## Docs\n- a\n\n| a | b |\n|---|---|\n| 1 | 2 |");
		const block = region(container).firstElementChild;
		expect({
			block: block?.className,
			table: block?.querySelector("table") !== null,
			heading: [block?.querySelector("h2")?.getAttribute("aria-level"), block?.querySelector("h2")?.textContent],
		}).toStrictEqual({block: "whitespace-normal", table: true, heading: ["4", "Docs"]});
	});

	it("keeps markdown plain when the tool disallows it", () => {
		const container = draw("| a | b |\n|---|---|\n| 1 | 2 |", false);
		expect(container.querySelector("table")).toBeNull();
	});

	it("draws columns text and an untiled JSON body in text-code, other text bare, all linkified", () => {
		const columns = region(draw("NAME  X\nfoo   y")).firstElementChild;
		const big = region(draw(JSON.stringify(Array.from({length: 2000}, (_, i) => i)))).firstElementChild;
		const text = region(draw("see https://e.com/x")).firstElementChild;
		expect({
			columns: columns?.className,
			big: [big?.className, big?.textContent.startsWith("[\n  0,\n")],
			text: [text?.getAttribute("class"), text?.querySelector("a")?.getAttribute("href")],
		}).toStrictEqual({
			columns: "text-code",
			big: ["text-code", true],
			text: [null, "https://e.com/x"],
		});
	});
});
