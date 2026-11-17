import {describe, expect, it} from "vite-plus/test";
import {parseAttachSnippets, parseReplyLead} from "../src/lib/attach-markers";

const UPSTREAM_EXAMPLE =
	"<!-- attach -->\n> Even so, they’re ful\n\n<!-- attach -->\n> Hermit crabs\n\n<!-- attach -->\n> Tide pools form in rocky hollo\n\n[upstream-sync test] In one sentence, what is a tide pool?";

describe("parseAttachSnippets", () =>
{
	it("strips upstream's leading attach blocks into snippets", () =>
	{
		expect(parseAttachSnippets(UPSTREAM_EXAMPLE)).toStrictEqual(
			{
				snippets: [
					{
						text: "Even so, they’re ful",
					},
					{
						text: "Hermit crabs",
					},
					{
						text: "Tide pools form in rocky hollo",
					},
				],
				rest: "[upstream-sync test] In one sentence, what is a tide pool?",
			},
		);
	});

	it("unwraps multi-line quotes, bare > lines, labels and terminal tabs", () =>
	{
		expect(
			parseAttachSnippets("<!-- attach: Terminal | tab:t-1 -->\n> line one\n>\n> line three\n\nprompt"),
		).toStrictEqual(
			{
				snippets: [
					{
						text: "line one\n\nline three",
						label: "Terminal",
						terminalTabId: "t-1",
					},
				],
				rest: "prompt",
			},
		);
	});

	it("returns only snippets when nothing follows them", () =>
	{
		expect(parseAttachSnippets("<!-- attach -->\n> only")).toStrictEqual(
			{
				snippets: [
					{
						text: "only",
					},
				],
				rest: "",
			},
		);
	});

	it("mirrors upstream's multiline flag, stripping a block that starts any line", () =>
	{
		expect(parseAttachSnippets("hello\n<!-- attach -->\n> later")).toStrictEqual(
			{
				snippets: [
					{
						text: "later",
					},
				],
				rest: "hello",
			},
		);
	});

	it("drops empty quotes and trims text without markers", () =>
	{
		expect([parseAttachSnippets("<!-- attach -->\n>\n\nask"), parseAttachSnippets("  plain  ")]).toStrictEqual([
			{
				snippets: [],
				rest: "ask",
			},
			{
				snippets: [],
				rest: "plain",
			},
		]);
	});
});

describe("parseReplyLead", () =>
{
	it("splits upstream's single reply lead into its quote and the body", () =>
	{
		expect(parseReplyLead("<!-- reply -->\n> a\n> b\n\nhello")).toStrictEqual(
			{
				replyQuote: "a\nb",
				parts: [
					{
						kind: "text",
						text: "hello",
					},
				],
			},
		);
	});

	it("splits a numbered lead into the reply quote, later quotes, their bodies and the prompt", () =>
	{
		expect(parseReplyLead("<!-- reply 2 -->\n> q1\n\nc1\n\n<!-- reply -->\n> q2\n\nc2\n\n\nprompt")).toStrictEqual(
			{
				replyQuote: "q1",
				parts: [
					{
						kind: "text",
						text: "c1",
					},
					{
						kind: "quote",
						text: "q2",
					},
					{
						kind: "text",
						text: "c2",
					},
					{
						kind: "text",
						text: "prompt",
					},
				],
			},
		);
	});

	it("stops scanning for blocks once the lead's count is reached", () =>
	{
		expect(parseReplyLead("<!-- reply 1 -->\n> q1\n\nc1\n\n<!-- reply -->\n> q2\n\nc2")).toStrictEqual(
			{
				replyQuote: "q1",
				parts: [
					{
						kind: "text",
						text: "c1\n\n<!-- reply -->\n> q2\n\nc2",
					},
				],
			},
		);
	});

	it("keeps an escaped reply marker in a body literal", () =>
	{
		expect(parseReplyLead("<!-- reply 1 -->\n> q\n\n&lt;!-- reply -->\n\n\nask")).toStrictEqual(
			{
				replyQuote: "q",
				parts: [
					{
						kind: "text",
						text: "&lt;!-- reply -->",
					},
					{
						kind: "text",
						text: "ask",
					},
				],
			},
		);
	});

	it("returns null for prompts without a well-formed reply lead", () =>
	{
		expect([
			parseReplyLead("hello <!-- reply -->\n> q"),
			parseReplyLead("<!-- reply -->\nno quote"),
			parseReplyLead("<!-- reply 0 -->\n> q\n\nc"),
			parseReplyLead("&lt;!-- reply -->\n> q\n\nc"),
		]).toStrictEqual([null, null, null, null]);
	});
});
