// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";
import {LIVE_PROMPT, LONG_BODY} from "./diff-annotation-fixtures";

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
	takeRecords()
	{
		return [];
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(
		HTMLElement.prototype,
		"scrollIntoView",
		{
			configurable: true,
			value: vi.fn<HTMLElement["scrollIntoView"]>(),
		},
	);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function renderRecords(records: unknown[]): HTMLElement
{
	const {lines, toolResultMap} = processTranscript(records);
	return render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries={true}
			showTranscriptOnly={true}
			shouldScrollToEnd={false}
			transcriptMode="normal"
		/>,
	).container;
}

function prompt(content: unknown): unknown
{
	return {
		type: "user",
		uuid: "user-plain-1",
		message:
		{
			role: "user",
			content,
		},
	};
}

const UPSTREAM_EXAMPLE =
	"<!-- attach -->\n> Even so, they’re ful\n\n<!-- attach -->\n> Hermit crabs\n\n<!-- attach -->\n> Tide pools form in rocky hollo\n\n[upstream-sync test] In one sentence, what is a tide pool?";

describe("SessionChat user bubble Excerpt tiles", () =>
{
	it("renders upstream's attach blocks as Excerpt tiles before a bubble holding only the prompt", () =>
	{
		const container = renderRecords([prompt(UPSTREAM_EXAMPLE)]);
		const row = container.querySelector("[data-cds=MessageAttachments]");
		const bubble = container.querySelector(".user-message-bubble");

		expect(
			{
				fit: row?.getAttribute("data-fit"),
				className: row?.className,
				beforeBubble:
					row !== null && bubble !== null
						? (row.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
						: false,
				tiles: Array.from(row?.querySelectorAll("[data-cds=MessageAttachmentsQuote]") ?? []).map((tile) => (
				{
					className: tile.className,
					quote: tile.querySelector("blockquote")?.textContent,
					badge: tile.querySelector("[data-cds=Badge]")?.textContent,
					remove: tile.querySelector("[data-cds-attachment-remove]") !== null,
				})),
				bubble: bubble?.textContent,
			},
		).toStrictEqual(
			{
				fit: "natural",
				className: "flex w-full flex-wrap justify-end gap-xs items-end empty:hidden",
				beforeBubble: true,
				tiles: ["Even so, they’re ful", "Hermit crabs", "Tide pools form in rocky hollo"].map((quote) => (
				{
					className:
						"group/tile relative isolate size-[7.5rem] shrink-0 rounded-card outline-none focus-visible:shadow-focus self-end select-text",
					quote,
					badge: "Excerpt",
					remove: false,
				})),
				bubble: "[upstream-sync test] In one sentence, what is a tide pool?",
			},
		);
	});

	it("parses attach blocks in a text content block too and omits the bubble when nothing follows", () =>
	{
		const container = renderRecords([
			prompt([
				{
					type: "text",
					text: "<!-- attach -->\n> Hermit crabs",
				},
			]),
		]);

		expect(
			{
				quotes: Array.from(container.querySelectorAll("[data-cds=MessageAttachmentsQuote] blockquote")).map(
					(quote) => quote.textContent,
				),
				bubble: container.querySelector(".user-message-bubble"),
			},
		).toStrictEqual(
			{
				quotes: ["Hermit crabs"],
				bubble: null,
			},
		);
	});
});

function tileSummary(tile: Element)
{
	const badge = tile.querySelector("[data-cds=Badge]");
	const hintId = badge?.getAttribute("aria-describedby")?.split(" ")[0];
	const hint = hintId === undefined ? null : tile.ownerDocument.getElementById(hintId);
	return {
		tabIndex: tile.getAttribute("tabindex"),
		name: tile.querySelector(".sr-only")?.textContent,
		quote: tile.querySelector("blockquote")?.textContent,
		quoteClass: tile.querySelector("blockquote")?.className,
		badge:
		{
			role: badge?.getAttribute("role") ?? null,
			label: badge?.getAttribute("aria-label") ?? null,
			tabIndex: badge?.getAttribute("tabindex") ?? null,
			text: badge?.textContent,
		},
		hint:
			hint === null
				? null
				:
					{
						text: hint.textContent,
						hidden: hint.hidden,
					},
	};
}

const QUOTE_CLASS =
	"min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-caption font-normal leading-tight text-secondary line-clamp-5";

describe("SessionChat user row diff comment tiles", () =>
{
	it("renders upstream's sent diff comments as Comment on {where} quote tiles and keeps only the prompt in the bubble", () =>
	{
		const container = renderRecords([prompt(LIVE_PROMPT)]);
		const row = container.querySelector("[data-cds=MessageAttachments]");
		const bubble = container.querySelector(".user-message-bubble");
		const comment = (name: string, quote: string, where: string) => (
		{
			tabIndex: "-1",
			name,
			quote,
			quoteClass: QUOTE_CLASS,
			badge:
			{
				role: "img",
				label: "Comment",
				tabIndex: "0",
				text: "Comment",
			},
			hint:
			{
				text: where,
				hidden: true,
			},
		});

		expect(
			{
				findOmitted: row?.getAttribute("data-find-omitted"),
				tiles: Array.from(row?.querySelectorAll("[data-cds=MessageAttachmentsQuote]") ?? []).map(tileSummary),
				bubbleHasComments: bubble?.textContent.includes("In `"),
				bubbleText: bubble?.textContent,
			},
		).toStrictEqual(
			{
				findOmitted: "",
				tiles: [
					comment("Comment on demo.ts:3", "Rename this constant to something clearer", "demo.ts:3"),
					comment("Comment on demo.ts:5-7 (before changes)", LONG_BODY, "demo.ts:5-7 (before changes)"),
					comment(
						"Comment on component-file-name.tsx:120",
						'<div className="x" />',
						"component-file-name.tsx:120",
					),
				],
				bubbleHasComments: false,
				bubbleText:
					"[upstream-sync test] Reply with only the word ok. Do nothing else: no tools, no files, no commands.\n\nThanks",
			},
		);
	});

	it("renders only the tiles row, with no bubble, for a prompt of comments alone", () =>
	{
		const container = renderRecords([prompt("In `a/b.ts` at line 4:\n```ts\nx();\n```\nWhy?")]);

		expect(
			{
				names: Array.from(container.querySelectorAll("[data-cds=MessageAttachmentsQuote] .sr-only")).map(
					(name) => name.textContent,
				),
				bubble: container.querySelector(".user-message-bubble"),
			},
		).toStrictEqual(
			{
				names: ["Comment on b.ts:4"],
				bubble: null,
			},
		);
	});

	it("puts excerpt tiles before comment tiles in one row", () =>
	{
		const container = renderRecords([
			prompt("<!-- attach -->\n> Hermit crabs\n\nIn `a.ts` at line 1:\n```\nx\n```\nFix\n\n\nGo"),
		]);

		expect(
			Array.from(container.querySelectorAll("[data-cds=MessageAttachments]")).map((row) =>
				Array.from(row.querySelectorAll("[data-cds=MessageAttachmentsQuote] .sr-only")).map(
					(name) => name.textContent,
				),
			),
		).toStrictEqual([["Hermit crabs", "Comment on a.ts:1"]]);
	});

	it("shows the comment's where in a tooltip when its badge takes keyboard focus", async () =>
	{
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0));
		renderRecords([prompt(LIVE_PROMPT)]);
		const [badge] = screen.getAllByRole(
			"img",
			{
				name: "Comment",
			},
		);
		if (badge === undefined) throw new Error("no badge");
		await act(async () =>
		{
			badge.focus();
			await Promise.resolve();
		});

		expect(screen.getByRole("tooltip").textContent).toBe("demo.ts:3");
	});
});

describe("SessionChat excerpt quote tile shell", () =>
{
	it("names an unlabelled excerpt by its first line and collapses its text to 240 graphemes", () =>
	{
		const text = `${"a".repeat(100)}\n${"b".repeat(100)}\n${"c".repeat(100)}`;
		const container = renderRecords([
			prompt(
				`<!-- attach -->\n${text
					.split("\n")
					.map((line) => `> ${line}`)
					.join("\n")}`,
			),
		]);
		const [tile] = Array.from(container.querySelectorAll("[data-cds=MessageAttachmentsQuote]"));
		if (tile === undefined) throw new Error("no tile");

		expect(tileSummary(tile)).toStrictEqual(
			{
				tabIndex: "-1",
				name: `${"a".repeat(59)}…`,
				quote: `${"a".repeat(100)} ${"b".repeat(100)} ${"c".repeat(37)}…`,
				quoteClass: QUOTE_CLASS,
				badge:
				{
					role: null,
					label: null,
					tabIndex: null,
					text: "Excerpt",
				},
				hint: null,
			},
		);
	});

	it("labels a labelled excerpt by its label, keeps the Excerpt badge and hints the label", () =>
	{
		const container = renderRecords([prompt("<!-- attach: Terminal -->\n> npm test")]);
		const [tile] = Array.from(container.querySelectorAll("[data-cds=MessageAttachmentsQuote]"));
		if (tile === undefined) throw new Error("no tile");

		expect(tileSummary(tile)).toStrictEqual(
			{
				tabIndex: "-1",
				name: "Terminal",
				quote: "npm test",
				quoteClass: QUOTE_CLASS,
				badge:
				{
					role: "img",
					label: "Excerpt",
					tabIndex: "0",
					text: "Excerpt",
				},
				hint:
				{
					text: "Terminal",
					hidden: true,
				},
			},
		);
	});
});
