// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import type {ComponentProps} from "react";

import {FileTypeIconSetContext} from "../src/components/file-type-icon-set-context";
import {FilesTree, FilesTreeColumn} from "../src/components/files/files-tree";
import {SettingsProvider} from "../src/components/settings-provider";
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
	windowSnippet,
} from "../src/lib/files-content-search";
import {installLocalStorage} from "./fake-storage";
import {TOUCH_REVEAL} from "../src/lib/touch-reveal";

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
	it("unescapes the server's HTML and finds the first highlighted range", () =>
	{
		expect(
			parseMarkedSnippet("if (a &lt; b &amp;&amp; <mark>needle</mark>) &quot;x&#39;s&quot; <mark>needle</mark>"),
		).toStrictEqual(
			{
				text: `if (a < b && needle) "x's" needle`,
				match:
				{
					start: 13,
					end: 19,
				},
			},
		);
	});

	it("returns no match when nothing is highlighted", () =>
	{
		expect(parseMarkedSnippet("plain &gt; text")).toStrictEqual(
			{
				text: "plain > text",
				match: null,
			},
		);
	});
});

describe("windowSnippet", () =>
{
	it("keeps a short lead as is, with whitespace collapsed and trimmed", () =>
	{
		const text = "    const   value =\tneedle;  ";
		expect(
			windowSnippet(
				text,
				{
					start: 20,
					end: 26,
				},
			),
		).toStrictEqual(
			{
				text: "const value = needle;",
				match:
				{
					start: 14,
					end: 20,
				},
			},
		);
	});

	it("keeps a lead of exactly 26 characters", () =>
	{
		const lead = "abcdefghijklmnopqrstuvwxy ";
		expect(
			windowSnippet(
				`${lead}needle`,
				{
					start: 26,
					end: 32,
				},
			),
		).toStrictEqual(
			{
				text: `${lead}needle`,
				match:
				{
					start: 26,
					end: 32,
				},
			},
		);
	});

	it("cuts a long lead to at most 26 characters, snapped to a word start, behind an ellipsis", () =>
	{
		const text = "aaaa bbbb cccc dddd eeee ffff gggg needle tail";
		expect(
			windowSnippet(
				text,
				{
					start: 35,
					end: 41,
				},
			),
		).toStrictEqual(
			{
				text: "…cccc dddd eeee ffff gggg needle tail",
				match:
				{
					start: 26,
					end: 32,
				},
			},
		);
	});

	it("cuts exactly at 26 characters when the cut already falls on a word start", () =>
	{
		const text = "aaaaaaa bbbb cccc dddd eeee fffff needle";
		expect(
			windowSnippet(
				text,
				{
					start: 34,
					end: 40,
				},
			),
		).toStrictEqual(
			{
				text: "…bbbb cccc dddd eeee fffff needle",
				match:
				{
					start: 27,
					end: 33,
				},
			},
		);
	});

	it("cuts mid-word when the lead has no word boundary to snap to", () =>
	{
		const text = `${"x".repeat(40)}needle`;
		expect(
			windowSnippet(
				text,
				{
					start: 40,
					end: 46,
				},
			),
		).toStrictEqual(
			{
				text: `…${"x".repeat(26)}needle`,
				match:
				{
					start: 27,
					end: 33,
				},
			},
		);
	});

	it("returns the collapsed text when there is no match", () =>
	{
		expect(windowSnippet("  a   b  ", null)).toStrictEqual(
			{
				text: "a b",
				match: null,
			},
		);
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
									text: "const needle = 1;",
									match:
									{
										start: 6,
										end: 12,
									},
								},
							},
							{
								line: 9,
								text: "return Needle;",
								snippet:
								{
									text: "return Needle;",
									match:
									{
										start: 7,
										end: 13,
									},
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
								text: `line ${line} needle`,
								match:
								{
									start: 7,
									end: 13,
								},
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
				<FileTypeIconSetContext value="pierre">
					<FilesTreeColumn>
						<FilesTree sessionId="content-session" cwd="/repo" onOpenFile={onOpenFile} onAsk={onAsk} />
					</FilesTreeColumn>
				</FileTypeIconSetContext>
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
	it("uses upstream's placeholder and describes ? content search in the hint", () =>
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
				placeholder: "Search files…",
				hint: "Results update as you type. Start with ? to search file contents. Press Down Arrow to go to results, and Up Arrow on the first result to return here.",
			},
		);
	});

	it("reveals each match's hover-only Ask about this button on touch", async () =>
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
		await screen.findByText("a.ts");

		expect(
			screen
				.getAllByRole(
					"button",
					{
						name: "Ask about this",
					},
				)
				.every((button) => button.className.includes(TOUCH_REVEAL)),
		).toBe(true);
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
		const {onOpenFile, onAsk} = renderTree();
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

		const groups = screen.getAllByRole("group").map((group) => (
		{
			file: group.getAttribute("aria-label"),
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
		fireEvent.click(
			screen.getAllByRole(
				"button",
				{
					name: "Ask about this",
				},
			)[0]!,
		);

		expect(
			{
				contentRequests: requests.filter((request) => request.startsWith("/api/search/files")),
				treeRequestedQuestion: requests.some(
					(request) => !request.startsWith("/api/search/files") && request.includes("%3F"),
				),
				groups,
				opens: onOpenFile.mock.calls,
				asks: onAsk.mock.calls,
			},
		).toStrictEqual(
			{
				contentRequests: ["/api/search/files?query=needle&scopeRoot=%2Frepo"],
				treeRequestedQuestion: false,
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
				asks: [["In src/a.ts at line 3: `const needle = 1;` — explain what this does and where it’s used."]],
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
		expect(await screen.findByText("No matches in file contents")).toBeTruthy();
	});

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
		const message = await screen.findByText("Couldn’t search in files.");
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
		await screen.findByText("The search didn’t finish. No matches so far.");
		const unfinishedRetry = retryButton()?.textContent;
		typeFilter("?nothing");
		await screen.findByText("No matches in file contents");

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
});
