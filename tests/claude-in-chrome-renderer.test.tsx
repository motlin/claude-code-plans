// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ClaudeInChromeRenderer} from "../src/components/tool-renderers/claude-in-chrome-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";

vi.mock("../src/hooks/use-shiki", () => ({
	useHighlightedLines: () => null,
	getHighlighterSync: () => null,
	getHighlighterVersion: () => 0,
	subscribeHighlighter: () => () => {},
}));

afterEach(cleanup);

function draw(result: string): HTMLElement {
	const call: ClientToolCall = {
		id: "tool-call-1",
		name: "mcp__claude-in-chrome__gif_creator",
		input: {},
		param: "",
		result,
		sourceUuid: "source-1",
	};
	return render(<ClaudeInChromeRenderer toolCall={call} />).container;
}

describe("claude-in-chrome result kinds follow upstream's generic body classifier", () => {
	it("renders markdown only when upstream's sniff accepts it, and pretty-prints JSON as upstream does", () => {
		const h1Only = draw("# Title\n- item 1\n- item 2");
		const h1Heading = h1Only.querySelector("h1");
		cleanup();
		const h2 = draw("## Title\n- item 1").querySelector("h2")?.textContent;
		cleanup();
		const json = draw('{"a":{}}').querySelector("pre")?.textContent;
		expect({h1Heading, h2, json}).toStrictEqual({h1Heading: null, h2: "Title", json: '{\n  "a": {}\n}'});
	});
});
