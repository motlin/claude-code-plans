import {describe, expect, it} from "vite-plus/test";
import {parseAttachSnippets} from "../src/lib/attach-markers";

const UPSTREAM_EXAMPLE =
	"<!-- attach -->\n> Even so, they’re ful\n\n<!-- attach -->\n> Hermit crabs\n\n<!-- attach -->\n> Tide pools form in rocky hollo\n\n[upstream-sync test] In one sentence, what is a tide pool?";

describe("parseAttachSnippets", () => {
	it("strips upstream's leading attach blocks into snippets", () => {
		expect(parseAttachSnippets(UPSTREAM_EXAMPLE)).toStrictEqual({
			snippets: [
				{text: "Even so, they’re ful"},
				{text: "Hermit crabs"},
				{text: "Tide pools form in rocky hollo"},
			],
			rest: "[upstream-sync test] In one sentence, what is a tide pool?",
		});
	});

	it("unwraps multi-line quotes, bare > lines, labels and terminal tabs", () => {
		expect(
			parseAttachSnippets("<!-- attach: Terminal | tab:t-1 -->\n> line one\n>\n> line three\n\nprompt"),
		).toStrictEqual({
			snippets: [{text: "line one\n\nline three", label: "Terminal", terminalTabId: "t-1"}],
			rest: "prompt",
		});
	});

	it("returns only snippets when nothing follows them", () => {
		expect(parseAttachSnippets("<!-- attach -->\n> only")).toStrictEqual({
			snippets: [{text: "only"}],
			rest: "",
		});
	});

	it("mirrors upstream's multiline flag, stripping a block that starts any line", () => {
		expect(parseAttachSnippets("hello\n<!-- attach -->\n> later")).toStrictEqual({
			snippets: [{text: "later"}],
			rest: "hello",
		});
	});

	it("drops empty quotes and trims text without markers", () => {
		expect([parseAttachSnippets("<!-- attach -->\n>\n\nask"), parseAttachSnippets("  plain  ")]).toStrictEqual([
			{snippets: [], rest: "ask"},
			{snippets: [], rest: "plain"},
		]);
	});
});
