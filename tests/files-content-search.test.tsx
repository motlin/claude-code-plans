// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {ComponentProps} from "react";

import {FileTypeIconSetContext} from "../src/components/file-type-icon-set-context";
import {FilesTree, FilesTreeColumn} from "../src/components/files/files-tree";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastProvider} from "../src/components/toast";
import type {FileSearchResult} from "../src/lib/api/search";
import
{
	askAboutPrompt,
	CONTENT_SEARCH_MESSAGES,
	contentSearchCapNote,
	contentSearchOutcome,
	type ContentSearchResults,
	groupContentSearchResults,
	keepResultsOnFailedRefetch,
	matchesSmartCase,
	parseContentSearchQuery,
	parseMarkedSnippet,
	snippetTailMinWidth,
	windowSnippet,
} from "../src/lib/files-content-search";
import {installLocalStorage} from "./fake-storage";

class FakeObserver
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

describe("parseContentSearchQuery", () =>
{
	it.each([
		["", null],
		["src/", null],
		["needle", null],
		[" ?needle", null],
		["?", ""],
		["?  ", ""],
		["?needle", "needle"],
		["? two words ", "two words"],
	])("%j → %j", (filter, expected) =>
	{
		expect(parseContentSearchQuery(filter)).toBe(expected);
	});
});

describe("parseMarkedSnippet", () =>
{
	it("unescapes the server's HTML and finds every highlighted range", () =>
	{
		expect(
			parseMarkedSnippet("if (a &lt; b &amp;&amp; <mark>needle</mark>) &quot;x&#39;s&quot; <mark>needle</mark>"),
		).toStrictEqual(
			{
				text: `if (a < b && needle) "x's" needle`,
				matches: [
					{
						start: 13,
						end: 19,
					},
					{
						start: 27,
						end: 33,
					},
				],
			},
		);
	});

	it("returns no matches when nothing is highlighted", () =>
	{
		expect(parseMarkedSnippet("plain &gt; text")).toStrictEqual(
			{
				text: "plain > text",
				matches: [],
			},
		);
	});
});

describe("windowSnippet", () =>
{
	const at = (text: string, needle: string) =>
	{
		const start = text.indexOf(needle);
		return [
			{
				start,
				end: start + needle.length,
			},
		];
	};
	const emojiLine = `${"\u{1F600}".repeat(30)} needle`;

	it.each([
		[
			"a short lead stays whole, trimmed and collapsed, its trailing space moving into the hit",
			"    const   value =\tneedle;  ",
			at("    const   value =\tneedle;  ", "needle"),
			{
				lead: "const value =",
				hit: " needle",
				hitMatches: [
					{
						start: 1,
						end: 7,
					},
				],
				tail: ";",
				tailMatches: [],
			},
		],
		[
			"a long lead is cut at the nearer word boundary, skipping the space, behind an ellipsis",
			"aaaa bbbb cccc dddd eeee ffff gggg needle tail",
			at("aaaa bbbb cccc dddd eeee ffff gggg needle tail", "needle"),
			{
				lead: "…cccc dddd eeee ffff gggg",
				hit: " needle",
				hitMatches: [
					{
						start: 1,
						end: 7,
					},
				],
				tail: " tail",
				tailMatches: [],
			},
		],
		[
			"a word to punctuation change is a boundary too",
			"const result = someObject.methodCall(argumentValue).needle",
			at("const result = someObject.methodCall(argumentValue).needle", "needle"),
			{
				lead: "…methodCall(argumentValue).",
				hit: "needle",
				hitMatches: [
					{
						start: 0,
						end: 6,
					},
				],
				tail: "",
				tailMatches: [],
			},
		],
		[
			"the backward boundary wins when it is nearer",
			"return foo.barBaz(quxValue, otherThing) + needle",
			at("return foo.barBaz(quxValue, otherThing) + needle", "needle"),
			{
				lead: "…(quxValue, otherThing) +",
				hit: " needle",
				hitMatches: [
					{
						start: 1,
						end: 7,
					},
				],
				tail: "",
				tailMatches: [],
			},
		],
		[
			"no boundary cuts exactly 26 before the match",
			`${"x".repeat(40)}needle`,
			at(`${"x".repeat(40)}needle`, "needle"),
			{
				lead: `…${"x".repeat(26)}`,
				hit: "needle",
				hitMatches: [
					{
						start: 0,
						end: 6,
					},
				],
				tail: "",
				tailMatches: [],
			},
		],
		[
			"a cut on a low surrogate steps past it",
			emojiLine,
			at(emojiLine, "needle"),
			{
				lead: `…${"\u{1F600}".repeat(12)}`,
				hit: " needle",
				hitMatches: [
					{
						start: 1,
						end: 7,
					},
				],
				tail: "",
				tailMatches: [],
			},
		],
		[
			"later matches are kept in the tail",
			"needle and needle again needle",
			[0, 11, 24].map((start) => (
			{
				start,
				end: start + 6,
			})),
			{
				lead: "",
				hit: "needle",
				hitMatches: [
					{
						start: 0,
						end: 6,
					},
				],
				tail: " and needle again needle",
				tailMatches: [
					{
						start: 5,
						end: 11,
					},
					{
						start: 18,
						end: 24,
					},
				],
			},
		],
		[
			"no match leaves the collapsed line as the tail",
			"  a   b  ",
			[],
			{
				lead: "",
				hit: "",
				hitMatches: [],
				tail: "a b",
				tailMatches: [],
			},
		],
	])("%s", (_name, text, matches, expected) =>
	{
		expect(windowSnippet(text, matches)).toStrictEqual(expected);
	});
});

describe("snippetTailMinWidth", () =>
{
	it.each([
		[
			"a short tail keeps its length, a word run of 3 asks for 8ch",
			{
				lead: "",
				hit: "needle",
				tail: " and",
			},
			"calc(max(2ch, min(4ch, round(down, 50%, 1ch), round(down, 100% - 6ch, 1ch))) + 0.015ch)",
		],
		[
			"a long word in the tail asks for its length plus 2, capped at 12ch",
			{
				lead: "…abc",
				hit: " x",
				tail: "abcdefghijklmnop rest",
			},
			"calc(max(2ch, min(12ch, round(down, 50%, 1ch), round(down, 100% - 4ch, 1ch))) + 0.015ch)",
		],
		[
			"wide characters in the hit count twice, a one-character tail floors at 1ch",
			{
				lead: "a",
				hit: "日本",
				tail: ";",
			},
			"calc(max(1ch, min(1ch, round(down, 50%, 1ch), round(down, 100% - 5ch, 1ch))) + 0.015ch)",
		],
	])("%s", (_name, parts, expected) =>
	{
		expect(snippetTailMinWidth(parts)).toBe(expected);
	});
});

describe("matchesSmartCase", () =>
{
	it.each([
		["const Needle = 1", "needle", true],
		["const Needle = 1", "Needle", true],
		["const needle = 1", "Needle", false],
		["const Needle = other", "Needle other", true],
	])("%j with %j → %s", (text, query, expected) =>
	{
		expect(matchesSmartCase(text, query)).toBe(expected);
	});
});

describe("askAboutPrompt", () =>
{
	it("fills the upstream template", () =>
	{
		expect(askAboutPrompt("src/a.ts", 12, "const needle = 1;")).toBe(
			"In src/a.ts at line 12: `const needle = 1;` — explain what this does and where it’s used.",
		);
	});
});

function searchFile(
	path: string,
	matchCount: number,
	matches: Array<
	{
		lineNumber: number;
		snippet: string;
	}>,
)
{
	return {
		path,
		matchCount,
		matches,
		mtime: "2026-09-01T00:00:00.000Z",
		rank: -1,
	};
}

const RESULT: FileSearchResult =
{
	files: [
		searchFile("/repo/src/a.ts", 2, [
			{
				lineNumber: 3,
				snippet: "const <mark>needle</mark> = 1;",
			},
			{
				lineNumber: 9,
				snippet: "  return <mark>Needle</mark>;",
			},
		]),
		searchFile("/repo/notes.md", 0, []),
		searchFile(
			"/repo/big.txt",
			7,
			[1, 2, 3, 4, 5, 6].map((lineNumber) => (
			{
				lineNumber,
				snippet: `line ${lineNumber} <mark>needle</mark>`,
			})),
		),
	],
	totalResults: 9,
	totalFiles: 3,
	isTruncated: false,
	unfinished: false,
};

describe("groupContentSearchResults", () =>
{
	it("groups matches per file relative to the working directory and drops path-only hits", () =>
	{
		expect(groupContentSearchResults(RESULT, "/repo", "needle")).toStrictEqual(
			{
				groups: [
					{
						path: "/repo/src/a.ts",
						relPath: "src/a.ts",
						more: false,
						maxLine: 9,
						matches: [
							{
								line: 3,
								text: "const needle = 1;",
								snippet:
								{
									lead: "const",
									hit: " needle",
									hitMatches: [
										{
											start: 1,
											end: 7,
										},
									],
									tail: " = 1;",
									tailMatches: [],
								},
							},
							{
								line: 9,
								text: "return Needle;",
								snippet:
								{
									lead: "return",
									hit: " Needle",
									hitMatches: [
										{
											start: 1,
											end: 7,
										},
									],
									tail: ";",
									tailMatches: [],
								},
							},
						],
					},
					{
						path: "/repo/big.txt",
						relPath: "big.txt",
						more: true,
						maxLine: 5,
						matches: [1, 2, 3, 4, 5].map((line) => (
						{
							line,
							text: `line ${line} needle`,
							snippet:
							{
								lead: `line ${line}`,
								hit: " needle",
								hitMatches: [
									{
										start: 1,
										end: 7,
									},
								],
								tail: "",
								tailMatches: [],
							},
						})),
					},
				],
				shown: 7,
				truncated: false,
				unfinished: false,
				failed: false,
			},
		);
	});

	it("applies smart case when the query has capitals", () =>
	{
		const grouped = groupContentSearchResults(RESULT, "/repo/", "Needle");
		expect(
			grouped.groups.map((group) => (
			{
				relPath: group.relPath,
				lines: group.matches.map((match) => match.line),
				more: group.more,
			})),
		).toStrictEqual([
			{
				relPath: "src/a.ts",
				lines: [9],
				more: false,
			},
		]);
	});

	it("lists at most 200 matches in all, marking the file cut at the cap as having more", () =>
	{
		const files = Array.from(
			{
				length: 67,
			},
			(_, fileIndex) =>
				searchFile(
					`/repo/f${fileIndex}.ts`,
					3,
					[1, 2, 3].map((lineNumber) => (
					{
						lineNumber,
						snippet: `<mark>needle</mark> ${lineNumber}`,
					})),
				),
		);
		const grouped = groupContentSearchResults(
			{
				files,
				totalResults: 201,
				totalFiles: 67,
				isTruncated: false,
				unfinished: false,
			},
			"/repo",
			"needle",
		);
		expect(
			{
				shown: grouped.shown,
				truncated: grouped.truncated,
				groupCount: grouped.groups.length,
				last: grouped.groups
					.map((group) => (
					{
						relPath: group.relPath,
						lines: group.matches.map((match) => match.line),
						more: group.more,
						maxLine: group.maxLine,
					}))
					.at(-1),
			},
		).toStrictEqual(
			{
				shown: 200,
				truncated: true,
				groupCount: 67,
				last:
				{
					relPath: "f66.ts",
					lines: [1, 2],
					more: true,
					maxLine: 2,
				},
			},
		);
	});

	it("drops files past the 200 cap and truncates on 241 raw matches or files the server left out", () =>
	{
		const fiveEach = (count: number) =>
			Array.from(
				{
					length: count,
				},
				(_, fileIndex) =>
					searchFile(
						`/repo/f${fileIndex}.ts`,
						5,
						[1, 2, 3, 4, 5].map((lineNumber) => (
						{
							lineNumber,
							snippet: `<mark>needle</mark> ${lineNumber}`,
						})),
					),
			);
		const summarize = (result: ContentSearchResults) => (
		{
			groups: result.groups.length,
			shown: result.shown,
			truncated: result.truncated,
		});
		expect(
			{
				pastCap: summarize(
					groupContentSearchResults(
						{
							files: fiveEach(41),
							totalResults: 205,
							totalFiles: 41,
							isTruncated: false,
							unfinished: false,
						},
						"/repo",
						"needle",
					),
				),
				exactlyAtCap: summarize(
					groupContentSearchResults(
						{
							files: fiveEach(40),
							totalResults: 200,
							totalFiles: 40,
							isTruncated: false,
							unfinished: false,
						},
						"/repo",
						"needle",
					),
				),
				rawOverLimit: summarize(
					groupContentSearchResults(
						{
							files: [
								searchFile(
									"/repo/big.txt",
									300,
									[1, 2, 3, 4, 5, 6].map((lineNumber) => (
									{
										lineNumber,
										snippet: `<mark>needle</mark> ${lineNumber}`,
									})),
								),
							],
							totalResults: 300,
							totalFiles: 1,
							isTruncated: true,
							unfinished: false,
						},
						"/repo",
						"needle",
					),
				),
				filesLeftOut: summarize(
					groupContentSearchResults(
						{
							...RESULT,
							isTruncated: true,
							totalFiles: 150,
						},
						"/repo",
						"needle",
					),
				),
			},
		).toStrictEqual(
			{
				pastCap:
				{
					groups: 40,
					shown: 200,
					truncated: true,
				},
				exactlyAtCap:
				{
					groups: 40,
					shown: 200,
					truncated: false,
				},
				rawOverLimit:
				{
					groups: 1,
					shown: 5,
					truncated: true,
				},
				filesLeftOut:
				{
					groups: 2,
					shown: 7,
					truncated: true,
				},
			},
		);
	});

	it("carries the server's unfinished flag", () =>
	{
		expect(
			groupContentSearchResults(
				{
					...RESULT,
					unfinished: true,
				},
				"/repo",
				"needle",
			).unfinished,
		).toBe(true);
	});
});

describe("contentSearchOutcome", () =>
{
	it.each([
		[0, true, true, "failed"],
		[2, true, false, "failed"],
		[2, false, true, "someMissing"],
		[2, false, false, undefined],
		[0, false, true, "unfinished"],
		[0, false, false, "none"],
	] as const)("%i groups, failed %s, unfinished %s → %s", (groupCount, failed, unfinished, expected) =>
	{
		expect(
			contentSearchOutcome(
				{
					groupCount,
					failed,
					unfinished,
				},
			),
		).toBe(expected);
	});

	it("uses upstream's messages", () =>
	{
		expect(CONTENT_SEARCH_MESSAGES).toStrictEqual(
			{
				none: "No matches in file contents",
				failed: "Couldn’t search in files.",
				unfinished: "The search didn’t finish. No matches so far.",
				someMissing: "The search didn’t finish, so some matches may be missing.",
			},
		);
	});
});

describe("contentSearchCapNote", () =>
{
	it.each([
		[1, true, false, "Only 1 match is shown. Keep typing to narrow."],
		[200, true, false, "Only 200 matches are shown. Keep typing to narrow."],
		[
			200,
			true,
			true,
			"Only 200 matches are shown. Keep typing to narrow. The search didn’t finish, so some matches may be missing.",
		],
		[3, false, true, "The search didn’t finish, so some matches may be missing."],
		[3, false, false, null],
	] as const)("%i shown, truncated %s, unfinished %s → %j", (shown, truncated, unfinished, expected) =>
	{
		expect(
			contentSearchCapNote(
				{
					shown,
					truncated,
					unfinished,
				},
			),
		).toBe(expected);
	});
});

describe("keepResultsOnFailedRefetch", () =>
{
	const empty: ContentSearchResults =
	{
		groups: [],
		shown: 0,
		truncated: false,
		unfinished: false,
		failed: false,
	};
	const previous = groupContentSearchResults(RESULT, "/repo", "needle");

	it.each([
		[
			"an empty unfinished refetch keeps the old groups, flagged unfinished",
			previous,
			{
				...empty,
				unfinished: true,
			},
			{
				...previous,
				unfinished: true,
			},
		],
		[
			"a failed refetch keeps the old groups, flagged unfinished",
			previous,
			{
				...empty,
				failed: true,
			},
			{
				...previous,
				unfinished: true,
			},
		],
		["an empty finished refetch replaces them", previous, empty, empty],
		[
			"nothing to keep without old groups",
			empty,
			{
				...empty,
				failed: true,
			},
			{
				...empty,
				failed: true,
			},
		],
		["no old data", undefined, empty, empty],
	] as const)("%s", (_name, before, next, expected) =>
	{
		expect(keepResultsOnFailedRefetch(before, next)).toStrictEqual(expected);
	});
});

const SEARCH_RESPONSE: FileSearchResult =
{
	files: [
		searchFile("/repo/src/a.ts", 1, [
			{
				lineNumber: 3,
				snippet: "const <mark>needle</mark> = 1;",
			},
		]),
		searchFile("/repo/big.txt", 9, [
			{
				lineNumber: 4,
				snippet: "line 4 <mark>needle</mark>",
			},
		]),
	],
	totalResults: 10,
	totalFiles: 2,
	isTruncated: false,
	unfinished: false,
};

let requests: string[];
/** Answers a content search; returns undefined for the default responses. */
let searchResponder: ((query: string | null) => Promise<Response> | undefined) | undefined;

function stubFetch(): void
{
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) =>
		{
			const url = new URL(input, "http://localhost");
			requests.push(`${url.pathname}?${url.searchParams.toString()}`);
			if (url.pathname === "/api/search/files")
			{
				const custom = searchResponder?.(url.searchParams.get("query"));
				if (custom !== undefined) return custom;
				return Promise.resolve(
					Response.json(
						url.searchParams.get("query") === "needle"
							? SEARCH_RESPONSE
							:
								{
									files: [],
									totalResults: 0,
									totalFiles: 0,
									isTruncated: false,
									unfinished: false,
								},
					),
				);
			}
			return Promise.resolve(
				Response.json(
					{
						kind: "listing",
						dir: "",
						entries: [],
						partial: false,
					},
				),
			);
		}),
	);
}

function renderTree()
{
	const onOpenFile = vi.fn<NonNullable<ComponentProps<typeof FilesTree>["onOpenFile"]>>();
	const onAsk = vi.fn<NonNullable<ComponentProps<typeof FilesTree>["onAsk"]>>();
	const queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	render(
		<QueryClientProvider client={queryClient}>
			<SettingsProvider>
				<ToastProvider>
					<FileTypeIconSetContext value="pierre">
						<FilesTreeColumn>
							<FilesTree sessionId="content-session" cwd="/repo" onOpenFile={onOpenFile} onAsk={onAsk} />
						</FilesTreeColumn>
					</FileTypeIconSetContext>
				</ToastProvider>
			</SettingsProvider>
		</QueryClientProvider>,
	);
	return {
		onOpenFile,
		onAsk,
	};
}

function filterInput(): HTMLInputElement
{
	return screen.getByRole(
		"textbox",
		{
			name: "Filter files",
		},
	);
}

beforeEach(() =>
{
	installLocalStorage();
	requests = [];
	searchResponder = undefined;
	stubFetch();
	vi.stubGlobal("ResizeObserver", FakeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("FilesTree content search", () =>
{
	function typeFilter(value: string): void
	{
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value,
				},
			},
		);
	}

	it("uses upstream's content-search placeholder and hint", () =>
	{
		renderTree();
		const input = filterInput();
		const hint = document.getElementById(input.getAttribute("aria-describedby") ?? "");
		expect(
			{
				placeholder: input.placeholder,
				hint: hint?.textContent,
			},
		).toStrictEqual(
			{
				placeholder: "Filter, or ? to search in files",
				hint: "Results update as you type. Press Down Arrow to go to results, and Up Arrow on the first result to return here.",
			},
		);
	});

	it("puts Ask about this first in a match row's context menu, with no hover button", async () =>
	{
		const {onAsk} = renderTree();
		typeFilter("?needle");
		await screen.findByText("a.ts");
		const row = document.querySelector<HTMLElement>('[data-content-match][data-row-index="0"]')!;
		const hoverButtons = screen.queryAllByRole(
			"button",
			{
				name: "Ask about this",
			},
		).length;
		fireEvent.contextMenu(
			row,
			{
				clientX: 40,
				clientY: 50,
			},
		);
		const items = await screen.findAllByRole("menuitem");
		const firstItem = items[0]?.textContent;
		fireEvent.click(items[0]!);

		expect(
			{
				hoverButtons,
				firstItem,
				asks: onAsk.mock.calls,
			},
		).toStrictEqual(
			{
				hoverButtons: 0,
				firstItem: "Ask about this",
				asks: [["In src/a.ts at line 3: `const needle = 1;` — explain what this does and where it’s used."]],
			},
		);
	});

	it("draws upstream's 12px file-type icon on each matched file row", async () =>
	{
		renderTree();
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value: "?needle",
				},
			},
		);
		const svg = (await screen.findByText("a.ts")).closest("[data-content-file]")?.querySelector("svg");

		expect(
			{
				fileTypeIcon: svg?.hasAttribute("data-file-type-icon"),
				width: svg?.style.width,
				className: svg?.getAttribute("class"),
				fill: svg?.querySelector("path")?.getAttribute("fill"),
			},
		).toStrictEqual(
			{
				fileTypeIcon: true,
				width: "12px",
				className: "shrink-0 self-center text-ink-muted",
				fill: "var(--fti-typescript)",
			},
		);
	});

	it("prompts for a query after a bare ?", async () =>
	{
		renderTree();
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value: "?",
				},
			},
		);
		expect(await screen.findByText("Type after ? to search in files")).toBeTruthy();
	});

	it("routes a ? query to the file content search scoped to the working directory", async () =>
	{
		const {onOpenFile} = renderTree();
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value: "?needle",
				},
			},
		);
		await screen.findByText("a.ts");

		const list = screen.getByRole(
			"tree",
			{
				name: "File content matches",
			},
		).firstElementChild!;
		const groupList =
		{
			role: list.getAttribute("role"),
			className: list.className,
			groupRoles: [...list.children].map((group) => group.getAttribute("role")),
		};
		const groups = [...list.children].map((group) => (
		{
			file: group.querySelector("[data-content-file]")?.getAttribute("title"),
			rows: [...group.querySelectorAll("[data-content-match]")].map((row) => row.textContent),
			more: group.querySelector("[data-content-more]")?.textContent ?? null,
		}));

		fireEvent.keyDown(
			filterInput(),
			{
				key: "ArrowDown",
			},
		);
		fireEvent.keyDown(
			document.activeElement!,
			{
				key: "Enter",
			},
		);

		expect(
			{
				contentRequests: requests.filter((request) => request.startsWith("/api/search/files")),
				treeRequestedQuestion: requests.some(
					(request) => !request.startsWith("/api/search/files") && request.includes("%3F"),
				),
				groupList,
				groups,
				opens: onOpenFile.mock.calls,
			},
		).toStrictEqual(
			{
				contentRequests: ["/api/search/files?query=needle&scopeRoot=%2Frepo"],
				treeRequestedQuestion: false,
				groupList:
				{
					role: "none",
					className: "flex flex-col gap-1.5",
					groupRoles: ["none", "none"],
				},
				groups: [
					{
						file: "src/a.ts",
						rows: ["3const needle = 1;"],
						more: null,
					},
					{
						file: "big.txt",
						rows: ["4line 4 needle"],
						more: "More matches in this file.",
					},
				],
				opens: [
					[
						"src/a.ts",
						{
							pin: false,
							line: 3,
							findQuery: "needle",
						},
					],
				],
			},
		);
	});

	it("says when file contents have no matches", async () =>
	{
		renderTree();
		fireEvent.change(
			filterInput(),
			{
				target:
				{
					value: "?nothing",
				},
			},
		);
		await screen.findByText(
			"No matches in file contents",
			{
				selector: "div",
			},
		);
		const status = filterInput().closest("[data-cds=Field]")?.parentElement?.querySelector("p[role=status]");
		expect(
			{
				className: status?.className,
				text: status?.textContent,
			},
		).toStrictEqual(
			{
				className: "sr-only",
				text: "No matches in file contents",
			},
		);
	});

	function searchResult(
		files: FileSearchResult["files"],
		overrides: Partial<FileSearchResult> = {},
	): FileSearchResult
	{
		return {
			files,
			totalResults: files.reduce((total, file) => total + file.matchCount, 0),
			totalFiles: files.length,
			isTruncated: false,
			unfinished: false,
			...overrides,
		};
	}

	function retryButton(): HTMLElement | null
	{
		return screen.queryByRole(
			"button",
			{
				name: /Try again|Searching files/,
			},
		);
	}

	it("offers Try again after a failed search, busy while it reruns, and re-announces a repeat failure", async () =>
	{
		let release: (() => void) | undefined;
		let calls = 0;
		searchResponder = async () =>
		{
			calls += 1;
			if (calls === 1)
				return Response.json(
					{},
					{
						status: 500,
					},
				);
			await new Promise<void>((resolve) =>
			{
				release = resolve;
			});
			return Response.json(
				{},
				{
					status: 500,
				},
			);
		};
		renderTree();
		typeFilter("?needle");
		const message = await screen.findByText(
			"Couldn’t search in files.",
			{
				selector: "div",
			},
		);
		const before =
		{
			messageClass: message.className,
			stackClass: message.parentElement?.className,
			retry: retryButton()?.textContent,
			status: document.querySelector("[data-retry-status]")?.textContent,
		};

		fireEvent.click(retryButton()!);
		await vi.waitFor(() =>
		{
			expect(release).toBeDefined();
		});
		const busy =
		{
			ariaBusy: retryButton()?.getAttribute("aria-busy"),
			label: retryButton()?.getAttribute("aria-label"),
		};
		release!();
		await vi.waitFor(() =>
		{
			expect(document.querySelector("[data-retry-status]")?.textContent).toBe("Couldn’t search in files.");
		});

		expect(
			{
				before,
				busy,
				calls,
				afterBusy: retryButton()?.getAttribute("aria-busy") ?? null,
			},
		).toStrictEqual(
			{
				before:
				{
					messageClass: "flex items-center justify-center px-lg py-1 text-body text-muted-as-secondary",
					stackClass: "flex flex-col items-center gap-sm",
					retry: "Try again",
					status: "",
				},
				busy:
				{
					ariaBusy: "true",
					label: "Searching files",
				},
				calls: 2,
				afterBusy: null,
			},
		);
	});

	it("says an unfinished search found nothing so far and offers Try again; no matches has no retry", async () =>
	{
		searchResponder = (query): Promise<Response> | undefined =>
			query === "pending"
				? Promise.resolve(
						Response.json(
							searchResult(
								[],
								{
									unfinished: true,
								},
							),
						),
					)
				: undefined;
		renderTree();
		typeFilter("?pending");
		await screen.findByText(
			"The search didn’t finish. No matches so far.",
			{
				selector: "div",
			},
		);
		const unfinishedRetry = retryButton()?.textContent;
		typeFilter("?nothing");
		await screen.findByText(
			"No matches in file contents",
			{
				selector: "div",
			},
		);

		expect(
			{
				unfinishedRetry,
				noneRetry: retryButton(),
			},
		).toStrictEqual(
			{
				unfinishedRetry: "Try again",
				noneRetry: null,
			},
		);
	});

	it("notes possibly missing matches under an unfinished result, keeping them when the retry finds nothing", async () =>
	{
		let calls = 0;
		searchResponder = async () =>
		{
			calls += 1;
			return Promise.resolve(
				Response.json(
					calls === 1
						? searchResult(
								[
									searchFile("/repo/src/a.ts", 1, [
										{
											lineNumber: 3,
											snippet: "const <mark>needle</mark> = 1;",
										},
									]),
								],
								{
									unfinished: true,
								},
							)
						: searchResult(
								[],
								{
									unfinished: true,
								},
							),
				),
			);
		};
		renderTree();
		typeFilter("?needle");
		const someMissing =
		{
			selector: "div",
		};
		const note = await screen.findByText("The search didn’t finish, so some matches may be missing.", someMissing);
		const first =
		{
			noteClass: note.className,
			noteStyle: note.getAttribute("style"),
			retryWrapClass: retryButton()?.closest(".pb-1\\.5")?.getAttribute("style"),
			describedBy: filterInput().getAttribute("aria-describedby")?.split(" ").includes(note.id),
		};
		fireEvent.click(retryButton()!);
		await vi.waitFor(() =>
		{
			expect(calls).toBe(2);
		});
		await vi.waitFor(() =>
		{
			expect(retryButton()?.getAttribute("aria-busy") ?? null).toBe(null);
		});

		expect(
			{
				first,
				rowsAfterRetry: [...document.querySelectorAll("[data-content-match]")].map((row) => row.textContent),
				noteAfterRetry:
					screen.queryByText("The search didn’t finish, so some matches may be missing.", someMissing) !==
					null,
				announced: document.querySelector("[data-retry-status]")?.textContent,
			},
		).toStrictEqual(
			{
				first:
				{
					noteClass: "py-1.5 text-footnote text-muted-as-secondary select-none",
					noteStyle: "padding-inline: 8px;",
					retryWrapClass: "padding-inline: 8px;",
					describedBy: true,
				},
				rowsAfterRetry: ["3const needle = 1;"],
				noteAfterRetry: true,
				announced: "The search didn’t finish, so some matches may be missing.",
			},
		);
	});

	it("caps the list at 200 matches with a note the filter describes", async () =>
	{
		searchResponder = async () =>
			Promise.resolve(
				Response.json(
					searchResult(
						Array.from(
							{
								length: 41,
							},
							(_, fileIndex) =>
								searchFile(
									`/repo/f${fileIndex}.ts`,
									5,
									[1, 2, 3, 4, 5].map((lineNumber) => (
									{
										lineNumber,
										snippet: `<mark>needle</mark> ${lineNumber}`,
									})),
								),
						),
					),
				),
			);
		renderTree();
		typeFilter("?needle");
		const note = await screen.findByText("Only 200 matches are shown. Keep typing to narrow.");

		expect(
			{
				rows: document.querySelectorAll("[data-content-match]").length,
				describedBy: filterInput().getAttribute("aria-describedby")?.split(" ").length,
				describesNote: filterInput().getAttribute("aria-describedby")?.split(" ").includes(note.id),
				retry: retryButton(),
			},
		).toStrictEqual(
			{
				rows: 200,
				describedBy: 2,
				describesNote: true,
				retry: null,
			},
		);
	});

	/** Holds the content search until `release` is called, answering with SEARCH_RESPONSE. */
	function deferSearch():
	{
		release: () => void;
	}
	{
		const gate:
		{
			release: () => void;
		} =
		{
			release: () =>
			{
			},
		};
		const held = new Promise<void>((resolve) =>
		{
			gate.release = resolve;
		});
		searchResponder = async () =>
		{
			await held;
			return Response.json(SEARCH_RESPONSE);
		};
		return gate;
	}

	function contentRequestCount(): number
	{
		return requests.filter((request) => request.startsWith("/api/search/files")).length;
	}

	function firstMatch(): HTMLElement | null
	{
		return document.querySelector<HTMLElement>('[data-content-match][data-row-index="0"]');
	}

	it("spins in the filter's start slot with Searching files while the first fetch runs", async () =>
	{
		const gate = deferSearch();
		renderTree();
		typeFilter("?needle");
		const slot = () => filterInput().parentElement?.querySelector(".grid.size-4");
		await vi.waitFor(() =>
		{
			expect(slot()?.querySelector("[role=status]")?.textContent).toBe("Searching files");
		});
		const searching = slot()?.querySelector("svg") ?? null;
		gate.release();
		await screen.findByText("a.ts");

		expect(
			{
				searching,
				statusAfter: slot()?.querySelector("[role=status]") ?? null,
				iconAfter: slot()?.querySelector("svg") !== null,
			},
		).toStrictEqual(
			{
				searching: null,
				statusAfter: null,
				iconAfter: true,
			},
		);
	});

	it("waits 250ms after typing before searching file contents", async () =>
	{
		renderTree();
		typeFilter("?needle");
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 180);
		});
		const early = contentRequestCount();
		await vi.waitFor(() =>
		{
			expect(contentRequestCount()).toBe(1);
		});
		expect(early).toBe(0);
	});

	it("moves focus to the first match on Enter", async () =>
	{
		renderTree();
		typeFilter("?needle");
		await screen.findByText("a.ts");
		fireEvent.keyDown(
			filterInput(),
			{
				key: "Enter",
			},
		);
		expect(document.activeElement).toBe(firstMatch());
	});

	it("remembers an Enter pressed before the results arrive and focuses the first match when they land", async () =>
	{
		const gate = deferSearch();
		renderTree();
		typeFilter("?needle");
		fireEvent.keyDown(
			filterInput(),
			{
				key: "Enter",
			},
		);
		const before = document.activeElement === filterInput() || document.activeElement === document.body;
		gate.release();
		await screen.findByText("a.ts");
		await vi.waitFor(() =>
		{
			expect(document.activeElement).toBe(firstMatch());
		});
		expect(before).toBe(true);
	});

	it("returns focus to the element focused before the filter on Escape with an empty query", () =>
	{
		renderTree();
		const outside = document.createElement("button");
		document.body.append(outside);
		outside.focus();
		filterInput().focus();
		fireEvent.keyDown(
			filterInput(),
			{
				key: "Escape",
			},
		);
		const focused = document.activeElement;
		outside.remove();
		expect(focused).toBe(outside);
	});

	it("draws upstream's match rows: line-number column sized to the widest line, a lead/hit/tail snippet with every hit marked, and a More matches row", async () =>
	{
		searchResponder = async () =>
			Promise.resolve(
				Response.json(
					searchResult([
						searchFile("/repo/big.txt", 9, [
							{
								lineNumber: 4,
								snippet: "<mark>needle</mark> and <mark>needle</mark>",
							},
							{
								lineNumber: 12,
								snippet: "line 12 <mark>needle</mark>",
							},
						]),
					]),
				),
			);
		renderTree();
		typeFilter("?needle");
		await screen.findByText("big.txt");
		const row = firstMatch()!;
		const primary = row.querySelector("[data-tree-primary]");
		const [lineNumber, snippetWrapper] = [...(primary?.children ?? [])];
		const snippet = snippetWrapper?.firstElementChild;
		const more = document.querySelector<HTMLElement>("[data-content-more]");
		const fileRow = document.querySelector("[data-content-file]");

		expect(
			{
				row:
				{
					tag: row.tagName,
					role: row.getAttribute("role"),
					level: row.getAttribute("aria-level"),
					treeRow: row.hasAttribute("data-tree-row"),
					className: row.className,
					style: row.getAttribute("style"),
				},
				primary:
				{
					tag: primary?.tagName,
					className: primary?.className,
				},
				lineNumber:
				{
					className: lineNumber?.className,
					widest: lineNumber?.getAttribute("data-widest"),
					text: lineNumber?.textContent,
				},
				snippet:
				{
					wrapperClassName: snippetWrapper?.className,
					dir: snippet?.getAttribute("dir"),
					className: snippet?.className,
					parts: [...(snippet?.children ?? [])].map((part) => (
					{
						dir: part.getAttribute("dir"),
						className: part.className,
						style: part.getAttribute("style"),
						inner: part.firstElementChild?.tagName === "SPAN" ? part.firstElementChild.className : null,
						text: part.textContent,
					})),
				},
				marks: [...row.querySelectorAll("mark")].map((mark) => (
				{
					className: mark.className,
					text: mark.textContent,
				})),
				more:
				{
					hidden: more?.getAttribute("aria-hidden"),
					className: more?.className,
					style: more?.getAttribute("style"),
					spans: [...(more?.children ?? [])].map((span) => (
					{
						className: span.className,
						widest: span.getAttribute("data-widest"),
						text: span.textContent,
					})),
					describesFile: fileRow?.getAttribute("aria-describedby") === more?.id,
				},
			},
		).toStrictEqual(
			{
				row:
				{
					tag: "DIV",
					role: "treeitem",
					level: "2",
					treeRow: true,
					className:
						"cds-reset flex w-full items-center gap-xs rounded text-body font-normal font-control select-none outline-none relative h-[var(--file-tree-row-h,var(--cds-h-control))] py-0 focus-visible:outline-hidden focus-visible:shadow-focus bg-transparent text-primary hover:bg-fill-ghost-hover data-[pressed]:bg-fill-ghost-hover group-data-[hover-rests]/file-tree:hover:bg-alpha-0",
					style: "padding-inline: 6px 8px;",
				},
				primary:
				{
					tag: "BUTTON",
					className:
						"flex flex-1 min-w-0 items-baseline text-start bg-transparent border-0 outline-none hide-focus-ring rounded-r2 before:absolute before:inset-0 before:content-[''] gap-1.5",
				},
				lineNumber:
				{
					className:
						"min-w-4 text-caption tabular-nums after:invisible after:block after:h-0 after:overflow-hidden after:content-[attr(data-widest)] shrink-0 text-secondary text-end",
					widest: "12",
					text: "4",
				},
				snippet:
				{
					wrapperClassName: "block min-w-0 flex-1",
					dir: "ltr",
					className:
						"flex w-[calc(round(down,100%,1ch)+0.04ch)] overflow-hidden whitespace-pre text-code text-secondary",
					parts: [
						{
							dir: null,
							className: "max-w-full shrink-0 overflow-hidden text-ellipsis text-primary",
							style: null,
							inner: null,
							text: "needle",
						},
						{
							dir: null,
							className: "shrink-[9999] overflow-hidden text-ellipsis text-primary",
							style: "min-width: calc(0.015ch + max(2ch, min(8ch, round(down, 50%, 1ch), round(down, 100% - 6ch, 1ch))));",
							inner: "text-secondary",
							text: " and needle",
						},
					],
				},
				marks: [
					{
						className: "bg-highlight text-primary rounded-sm",
						text: "needle",
					},
					{
						className: "bg-highlight text-primary rounded-sm",
						text: "needle",
					},
				],
				more:
				{
					hidden: "true",
					className: "flex items-center gap-1.5 h-control text-footnote text-secondary select-none",
					style: "padding-inline: 6px 8px;",
					spans: [
						{
							className:
								"min-w-4 text-caption tabular-nums after:invisible after:block after:h-0 after:overflow-hidden after:content-[attr(data-widest)] shrink-[9999]",
							widest: "12",
							text: "",
						},
						{
							className: "min-w-0 truncate",
							widest: null,
							text: "More matches in this file.",
						},
					],
					describesFile: true,
				},
			},
		);
	});

	it("puts a long line's cut lead in an rtl span so it ellipsizes from the left", async () =>
	{
		searchResponder = async () =>
			Promise.resolve(
				Response.json(
					searchResult([
						searchFile("/repo/src/a.ts", 1, [
							{
								lineNumber: 3,
								snippet: "aaaa bbbb cccc dddd eeee ffff gggg <mark>needle</mark> tail",
							},
						]),
					]),
				),
			);
		renderTree();
		typeFilter("?needle");
		await screen.findByText("a.ts");
		const lead = firstMatch()?.querySelector("[data-tree-primary] > span > span[dir=ltr] > span[dir=rtl]");

		expect(
			{
				className: lead?.className,
				inner: lead?.firstElementChild?.getAttribute("dir"),
				text: lead?.textContent,
			},
		).toStrictEqual(
			{
				className: "min-w-0 overflow-hidden text-ellipsis",
				inner: "ltr",
				text: "…cccc dddd eeee ffff gggg",
			},
		);
	});

	it("opens a match as a kept tab on double-click and middle-click", async () =>
	{
		const {onOpenFile} = renderTree();
		typeFilter("?needle");
		await screen.findByText("a.ts");
		const primary = firstMatch()!.querySelector<HTMLElement>("[data-tree-primary]")!;
		fireEvent.doubleClick(primary);
		fireEvent(
			primary,
			new MouseEvent(
				"auxclick",
				{
					bubbles: true,
					button: 1,
				},
			),
		);
		const kept =
		{
			pin: true,
			line: 3,
			findQuery: "needle",
		};
		expect(onOpenFile.mock.calls).toStrictEqual([
			["src/a.ts", kept],
			["src/a.ts", kept],
		]);
	});
});
