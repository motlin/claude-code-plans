// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, waitFor} from "@testing-library/react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {FileRefsProvider} from "../src/components/file-refs-context";
import {SessionChat} from "../src/components/session-chat";
import type {FileRef} from "../src/lib/file-refs";
import {summarizeToolCalls, summarizeToolCallStats} from "../src/lib/session-utils";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({settings: {showDebug: true}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

interface FakeCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
	isError?: boolean;
	pending?: true;
	/** The result's `toolDenialKind`, such as "user-rejected". */
	denialKind?: string;
}

/** One assistant record per call, each followed by its tool_result. */
function toolRunRecords(calls: FakeCall[]): unknown[] {
	return calls.flatMap((call) => [
		{
			type: "assistant",
			uuid: `a-${call.id}`,
			message: {
				role: "assistant",
				content: [{type: "tool_use", id: call.id, name: call.name, input: call.input}],
			},
		},
		...(call.pending
			? []
			: [
					{
						type: "user",
						uuid: `r-${call.id}`,
						parentUuid: `a-${call.id}`,
						...(call.denialKind === undefined ? {} : {toolDenialKind: call.denialKind}),
						message: {
							role: "user",
							content: [
								{
									type: "tool_result",
									tool_use_id: call.id,
									content: "ok",
									is_error: call.isError ?? false,
								},
							],
						},
					},
				]),
	]);
}

function renderRun(calls: FakeCall[]): string {
	const {lines, toolResultMap} = processTranscript(toolRunRecords(calls));
	return renderToStaticMarkup(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
		/>,
	);
}

function summaryButton(html: string): string {
	const match = html.match(/<button type="button" aria-expanded="false"[\s\S]*?<\/button>/);
	return match?.[0] ?? "";
}

/** The group header's label, read by the id its toggle is labelled by (it sits outside the toggle beside a meta slot). */
function summaryLabel(html: string): string {
	const root = document.createElement("div");
	root.innerHTML = html;
	const labelId = root.querySelector("button[aria-expanded]")?.getAttribute("aria-labelledby")?.split(" ")[0];
	return labelId === undefined ? "" : (root.querySelector(`[id="${labelId}"]`)?.textContent ?? "");
}

/** The group header's diff stat pill: each segment's ink and text, and the screen-reader line. */
function statSpans(html: string): {segments: string[]; srOnly: string | null} {
	const button = document.createElement("div");
	button.innerHTML = summaryButton(html);
	const pill = button.querySelector("[data-diff-stat-pill]");
	return {
		segments: [...(pill?.querySelectorAll("[data-diff-stat-segment]") ?? [])].map(
			(segment) =>
				`${segment.className.split(" ").find((name) => name.startsWith("text-diff-")) ?? ""}:${segment.textContent}`,
		),
		srOnly: pill?.querySelector(".sr-only")?.textContent ?? null,
	};
}

describe("ExitPlanMode in a summary", () => {
	it("folds into the generic tool segment, since upstream never groups ExitPlanMode", () => {
		expect(summarizeToolCalls([{name: "ExitPlanMode", input: {plan: "# Plan"}}])).toBe("used a tool");
	});
});

describe("summarizeToolCallStats", () => {
	it("keeps a lone segment's failure inline, with no trailing part", () => {
		expect(
			summarizeToolCallStats([
				{name: "Bash", input: {command: "ls"}},
				{name: "Bash", input: {command: "false"}, isError: true},
				{name: "Bash", input: {command: "pwd"}},
			]),
		).toStrictEqual({
			segments: [{verb: "Ran", rest: "3 commands (1 failed)"}],
			trailing: null,
			added: 0,
			removed: 0,
			failed: 1,
			blocked: 0,
		});
	});

	it("separates diff stats from the segment text", () => {
		expect(
			summarizeToolCallStats([
				{name: "Read", input: {file_path: "/repo/a.ts"}},
				{name: "Edit", input: {file_path: "/repo/b.ts", old_string: "a\nb", new_string: "c"}},
			]),
		).toStrictEqual({
			segments: [
				{verb: "Read", rest: "a file"},
				{verb: "edited", rest: "a file"},
			],
			trailing: null,
			added: 1,
			removed: 2,
			failed: 0,
			blocked: 0,
		});
	});

	it("keeps the failure count out of several segments and trails it", () => {
		expect(
			summarizeToolCallStats([
				{name: "Read", input: {file_path: "/repo/a.ts"}, isError: true},
				{name: "Grep", input: {pattern: "x"}},
			]),
		).toStrictEqual({
			segments: [
				{verb: "Read", rest: "a.ts"},
				{verb: "searched", rest: "code"},
			],
			trailing: ", 1 failed",
			added: 0,
			removed: 0,
			failed: 1,
			blocked: 0,
		});
	});

	it("renders the plain-text label with failures and trailing stats", () => {
		expect(
			summarizeToolCalls([
				{name: "Bash", input: {command: "ls"}, isError: true},
				{name: "Bash", input: {command: "ls"}},
				{name: "Edit", input: {file_path: "/repo/b.ts", old_string: "a\nb", new_string: ""}},
			]),
		).toBe("ran 2 commands, edited b.ts, 1 failed +0 -2");
	});
});

describe("created file diff stats", () => {
	it("counts a created file's lines without a phantom line after its final newline", () => {
		const added = (content: string) =>
			summarizeToolCallStats([{name: "Write", input: {file_path: "/repo/a.md", content}}]).added;
		expect({
			trailingNewline: added("one\ntwo\nthree\n"),
			noTrailingNewline: added("one\ntwo\nthree"),
			blankLastLine: added("one\ntwo\n\n"),
			empty: added(""),
		}).toStrictEqual({trailingNewline: 3, noTrailingNewline: 3, blankLastLine: 3, empty: 0});
	});
});

describe("failed edits in diff stats", () => {
	const sixLines = Array.from({length: 6}, (_, i) => `added ${i}`).join("\n");
	const lines = (count: number) => Array.from({length: count}, (_, i) => `line ${i}`).join("\n");

	it("leaves a failed edit out of the group header's totals", () => {
		const {added, removed} = summarizeToolCallStats([
			{name: "Edit", input: {file_path: "/repo/a.tsx", old_string: "", new_string: sixLines}, isError: true},
			{name: "Read", input: {file_path: "/repo/a.tsx"}},
			{name: "Read", input: {file_path: "/repo/b.json"}},
			{name: "Bash", input: {command: "ls"}},
			{name: "Edit", input: {file_path: "/repo/a.tsx", old_string: "", new_string: sixLines}},
			{name: "Edit", input: {file_path: "/repo/b.json", old_string: "", new_string: lines(25)}},
		]);
		expect({added, removed}).toStrictEqual({added: 31, removed: 0});
	});

	it("draws a failed edit row with its Failed status and no diff stat", () => {
		const {lines: transcript, toolResultMap} = processTranscript(
			toolRunRecords([
				{
					id: "t-failed",
					name: "Edit",
					input: {file_path: "/repo/a.tsx", old_string: "", new_string: sixLines},
					isError: true,
				},
			]),
		);
		const {container} = render(
			<SessionChat
				sessionId="test-session"
				lines={transcript}
				toolResultMap={toolResultMap}
				showTools
				shouldScrollToEnd={false}
			/>,
		);
		const row = container.querySelector<HTMLElement>("[data-tool-row]")!;
		expect({
			text: row.querySelector(".group\\/tool")?.textContent,
			stats: Array.from(row.querySelectorAll("[class*='text-diff-']"), (span) => span.textContent),
		}).toStrictEqual({text: "Editinga.tsxFailed", stats: []});
	});

	function lonePathRow(call: FakeCall): {text: string | null; stats: (string | null)[]; pill?: boolean} {
		const {lines: transcript, toolResultMap} = processTranscript(toolRunRecords([call]));
		const {container} = render(
			<SessionChat
				sessionId="test-session"
				lines={transcript}
				toolResultMap={toolResultMap}
				showTools
				shouldScrollToEnd={false}
			/>,
		);
		const row = container.querySelector<HTMLElement>("[data-tool-row]")!;
		const text = row.querySelector(".group\\/tool")?.textContent ?? null;
		const stats = Array.from(row.querySelectorAll("[class*='text-diff-']"), (span) => span.textContent);
		return stats.length === 0
			? {text, stats}
			: {text, stats, pill: row.querySelector("[data-diff-stat-pill]") !== null};
	}

	it("counts a lone Write row's created lines as a group does, in upstream's stat pill", () => {
		expect(
			lonePathRow({id: "t-write", name: "Write", input: {file_path: "/repo/x.mjs", content: "a\nb\n"}}),
		).toStrictEqual({text: "Createdx.mjs+2−02 added, 0 removed", stats: ["+2", "−0"], pill: true});
	});

	it("reads a ToolSearch row as upstream's bare 'Loaded tools', without its query", () => {
		expect(
			lonePathRow({id: "t-search", name: "ToolSearch", input: {query: "select:WebSearch,WebFetch"}}),
		).toStrictEqual({text: "Loaded tools", stats: []});
	});

	it("draws a failed Write row with no diff stat", () => {
		expect(
			lonePathRow({
				id: "t-write",
				name: "Write",
				input: {file_path: "/repo/x.mjs", content: "a\nb\n"},
				isError: true,
			}),
		).toStrictEqual({text: "Writingx.mjsFailed", stats: []});
	});
});

describe("ToolCallSummary stats and ink", () => {
	it('shows "Ran 3 commands (1 failed)" in the collapsed summary label', () => {
		const html = renderRun([
			{id: "t1", name: "Bash", input: {command: "ls"}},
			{id: "t2", name: "Bash", input: {command: "false"}, isError: true},
			{id: "t3", name: "Bash", input: {command: "pwd"}},
		]);
		expect({label: summaryLabel(html), stats: statSpans(html)}).toStrictEqual({
			label: "Ran 3 commands (1 failed)",
			stats: {segments: [], srOnly: null},
		});
	});

	it("trails the group's failure total in upstream's counted-line count, outside the clipped names", () => {
		const root = document.createElement("div");
		root.innerHTML = summaryButton(
			renderRun([
				{id: "t1", name: "WebFetch", input: {url: "https://example.invalid/a"}, isError: true},
				{id: "t2", name: "WebFetch", input: {url: "https://example.invalid/b"}, isError: true},
				{id: "t3", name: "Agent", input: {description: "Say ok", prompt: "Reply ok"}},
			]),
		);
		const label = root.querySelector("[id$=-label]");
		const names = root.querySelector("[data-testid=counted-line-names]");
		const count = root.querySelector("[data-testid=counted-line-count]");
		expect({
			labelIsLine: names?.parentElement === label,
			line: label?.className,
			seat: label?.hasAttribute("data-cds-phrases-seat"),
			names: names?.textContent,
			namesClass: names?.className,
			count: count?.textContent,
			countTag: count?.tagName,
			countClass: count?.className,
			countFollowsNames: names?.nextElementSibling === count,
		}).toStrictEqual({
			labelIsLine: true,
			line: "flex min-w-0 text-body",
			seat: false,
			names: "Fetched 2 pages, ran an agent",
			namesClass: "min-w-0 truncate",
			count: ", 2 failed",
			countTag: "BDI",
			countClass: "shrink-0 whitespace-pre",
			countFollowsNames: true,
		});
	});

	it("keeps a lone segment's failure inline in the bare phrases, with no counted line", () => {
		const root = document.createElement("div");
		root.innerHTML = summaryButton(
			renderRun([
				{id: "t1", name: "Bash", input: {command: "false"}, isError: true},
				{id: "t2", name: "Bash", input: {command: "ls"}},
			]),
		);
		const label = root.querySelector("[id$=-label]");
		expect({
			names: root.querySelector("[data-testid=counted-line-names]"),
			count: root.querySelector("[data-testid=counted-line-count]"),
			text: label?.textContent,
			seat: label?.getAttribute("data-cds-phrases-seat"),
		}).toStrictEqual({names: null, count: null, text: "Ran 2 commands (1 failed)", seat: ""});
	});

	it("keeps a lone segment's failed and stopped counts inline, with no counted-line count", () => {
		const root = document.createElement("div");
		root.innerHTML = summaryButton(
			renderRun([
				{id: "t1", name: "Bash", input: {command: "ls"}},
				{id: "t2", name: "Bash", input: {command: "false"}, isError: true},
				{id: "t3", name: "Bash", input: {command: "rm"}, isError: true, denialKind: "user-rejected"},
			]),
		);
		expect({
			count: root.querySelector("[data-testid=counted-line-count]"),
			text: root.querySelector("[id$=-label]")?.textContent,
		}).toStrictEqual({count: null, text: "Ran 3 commands (1 failed, 1 stopped)"});
	});

	it("draws neither counted-line names nor count when nothing failed", () => {
		const root = document.createElement("div");
		root.innerHTML = summaryButton(
			renderRun([
				{id: "t1", name: "Bash", input: {command: "ls"}},
				{id: "t2", name: "Bash", input: {command: "pwd"}},
			]),
		);
		expect({
			names: root.querySelector("[data-testid=counted-line-names]"),
			count: root.querySelector("[data-testid=counted-line-count]"),
		}).toStrictEqual({names: null, count: null});
	});

	it("moves a fold into the unclipped count, after names ending in a comma", () => {
		const root = document.createElement("div");
		root.innerHTML = summaryButton(
			renderRun([
				{id: "t1", name: "Bash", input: {command: "ls"}},
				{id: "t2", name: "Grep", input: {pattern: "x"}},
				{id: "t3", name: "Glob", input: {pattern: "*"}},
				{id: "t4", name: "WebSearch", input: {query: "q"}},
				{id: "t5", name: "WebFetch", input: {url: "https://example.invalid/a"}},
			]),
		);
		expect({
			names: root.querySelector("[data-testid=counted-line-names]")?.textContent,
			count: root.querySelector("[data-testid=counted-line-count]")?.textContent,
		}).toStrictEqual({names: "Ran a command, searched code, found files,", count: " and 2 more actions"});
	});

	it("renders diff stats as upstream's trailing two-tone pill, separate from the label", () => {
		const html = renderRun([
			{id: "t1", name: "Read", input: {file_path: "/repo/a.ts"}},
			{
				id: "t2",
				name: "Edit",
				input: {file_path: "/repo/b.ts", old_string: "a\nb\nc", new_string: "d"},
			},
		]);
		const container = document.createElement("div");
		container.innerHTML = summaryButton(html);
		const pill = container.querySelector("[data-diff-stat-pill]");
		expect({
			label: summaryLabel(html),
			stats: statSpans(html),
			wrapper: pill?.className,
			chip: pill?.firstElementChild?.className,
			segments: [...(pill?.querySelectorAll("[data-diff-stat-segment]") ?? [])].map(
				(segment) => segment.className,
			),
		}).toStrictEqual({
			label: "Read a file, edited a file",
			stats: {segments: ["text-diff-added:+1", "text-diff-removed:−3"], srOnly: "1 added, 3 removed"},
			wrapper: "ms-1 inline-flex h-[1lh] shrink-0 items-center text-ink-muted tabular-nums",
			chip: "inline-flex h-4 overflow-clip rounded-r3 text-[10px]/[13px] font-medium",
			segments: [
				"flex items-center gap-[1px] px-1 text-diff-added bg-diff-added/20",
				"flex items-center gap-[1px] px-1 text-diff-removed bg-diff-removed/20",
			],
		});
	});

	it('shows "+0 −28" when only lines were removed', () => {
		const removed = Array.from({length: 28}, (_, i) => `line${i}`).join("\n");
		const html = renderRun([
			{id: "t1", name: "Read", input: {file_path: "/repo/a.ts"}},
			{
				id: "t2",
				name: "Edit",
				input: {file_path: "/repo/b.ts", old_string: removed, new_string: ""},
			},
		]);
		expect(statSpans(html)).toStrictEqual({
			segments: ["text-diff-added:+0", "text-diff-removed:−28"],
			srOnly: "0 added, 28 removed",
		});
	});

	it("uses muted ink with a secondary hover on the collapsed label", () => {
		const html = renderRun([
			{id: "t1", name: "Read", input: {file_path: "/repo/a.ts"}},
			{id: "t2", name: "Bash", input: {command: "ls"}},
		]);
		expect(
			summaryButton(html).includes(
				'<span class="inline-flex items-center gap-g3 min-w-0 text-secondary group-hover/tool:text-secondary">',
			),
		).toBe(true);
	});

	it("keeps the open summary label secondary", () => {
		const {lines, toolResultMap} = processTranscript(
			toolRunRecords([
				{id: "t1", name: "Read", input: {file_path: "/repo/a.ts"}},
				{id: "t2", name: "Bash", input: {command: "ls"}},
			]),
		);
		const {container} = render(
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				showCompactSummaries
				showTranscriptOnly
				shouldScrollToEnd={false}
			/>,
		);
		const button = container.querySelector('button[aria-expanded="false"]')!;
		fireEvent.click(button);
		expect({
			expanded: button.getAttribute("aria-expanded"),
			ink: button.firstElementChild?.className,
		}).toStrictEqual({
			expanded: "true",
			ink: "inline-flex items-center gap-g3 min-w-0 text-secondary",
		});
	});
});

describe("group header file meta slot", () => {
	const META_CLASS =
		"min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap py-[0.125em] -my-[0.125em] text-secondary group-hover/tool:text-primary group-has-[:focus-visible]/tool:text-primary";
	const commandsThenRead = (readError = false): FakeCall[] => [
		{id: "t1", name: "Bash", input: {command: "ls"}},
		{id: "t2", name: "Bash", input: {command: "pwd"}},
		{id: "t3", name: "Read", input: {file_path: "/r/input-debug.png"}, isError: readError},
	];

	function mount(calls: FakeCall[]): HTMLElement {
		const root = document.createElement("div");
		root.innerHTML = renderRun(calls);
		return root;
	}

	it("moves the trailing sole file out of the phrases into a meta slot beside the toggle, as upstream's j() does", () => {
		const root = mount(commandsThenRead());
		const toggle = root.querySelector("button[aria-expanded]");
		const meta = root.querySelector("[id$=-meta]");
		const text = meta?.parentElement;
		expect({
			label: root.querySelector("[id$=-label]")?.textContent,
			labelClass: root.querySelector("[id$=-label]")?.className,
			metaClass: meta?.className,
			metaTitle: meta?.getAttribute("title"),
			metaText: meta?.textContent,
			metaInToggle: toggle?.contains(meta ?? null),
			textClass: text?.className.split(" ").slice(0, 4).join(" "),
			labelledBy: toggle
				?.getAttribute("aria-labelledby")
				?.split(" ")
				.map((id) => id.slice(id.lastIndexOf("-"))),
			rowTitle: text?.parentElement?.getAttribute("title"),
			rowHoldsToggle: text?.parentElement?.contains(toggle ?? null),
			status: root.querySelector("[role=status]")?.textContent,
		}).toStrictEqual({
			label: "Ran 2 commands, read",
			labelClass: "block min-w-0 truncate text-body shrink-0",
			metaClass: META_CLASS,
			metaTitle: "/r/input-debug.png",
			metaText: "input-debug.png",
			metaInToggle: false,
			textClass: "flex min-w-0 gap-xs items-center",
			labelledBy: ["-label", "-meta"],
			rowTitle: "/r/input-debug.png",
			rowHoldsToggle: true,
			status: "Ran 2 commands, read input-debug.png",
		});
	});

	const LINK_CLASS =
		"block min-w-0 truncate text-primary hover:underline underline-offset-[3px] focus-visible:outline-hidden hide-focus-ring focus-visible:shadow-focus rounded-sm";

	function chat(calls: FakeCall[]) {
		const {lines, toolResultMap} = processTranscript(toolRunRecords(calls));
		return (
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				showCompactSummaries
				showTranscriptOnly
			/>
		);
	}

	async function mountLinked(open: (ref: FileRef) => void): Promise<{root: HTMLElement; link: HTMLElement}> {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input) !== "/api/file-refs")
					return Promise.resolve(Response.json({error: "not found"}, {status: 404}));
				const {paths} = JSON.parse(String(init?.body)) as {paths: string[]};
				return Promise.resolve(
					Response.json({statuses: Object.fromEntries(paths.map((path) => [path, "exists"]))}),
				);
			}),
		);
		const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
		const {container} = render(
			<QueryClientProvider client={client}>
				<FileRefsProvider value={{sessionId: "meta-link", cwd: "/r", sessionPaths: [], open}}>
					{chat(commandsThenRead())}
				</FileRefsProvider>
			</QueryClientProvider>,
		);
		const link = await waitFor(() => {
			const found = container.querySelector<HTMLElement>("[id$=-meta] > [data-file-ref]");
			expect(found).not.toBeNull();
			return found!;
		});
		return {root: container, link};
	}

	it("makes the meta name a file link that opens the file without toggling the group", async () => {
		const open = vi.fn<(ref: FileRef) => void>();
		const {root, link} = await mountLinked(open);
		fireEvent.click(link);
		const afterClick = open.mock.calls.length;
		fireEvent.keyDown(link, {key: "Enter"});
		expect({
			tag: link.tagName,
			role: link.getAttribute("role"),
			tabIndex: link.getAttribute("tabindex"),
			className: link.className,
			inner: link.innerHTML,
			afterClick,
			opened: open.mock.calls.map(([ref]) => ref.path),
			expanded: root.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded"),
		}).toStrictEqual({
			tag: "SPAN",
			role: "button",
			tabIndex: "0",
			className: LINK_CLASS,
			inner: "<bdi>input-debug.png</bdi>",
			afterClick: 1,
			opened: ["/r/input-debug.png", "/r/input-debug.png"],
			expanded: "false",
		});
	});

	it("still toggles the group from a click on the row's label", async () => {
		const {root} = await mountLinked(vi.fn());
		fireEvent.click(root.querySelector("[id$=-label]")!);
		expect(root.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded")).toBe("true");
	});

	it("draws a plain bdi name outside a file-refs provider", () => {
		const root = mount(commandsThenRead());
		expect(root.querySelector("[id$=-meta]")?.innerHTML).toBe("<bdi>input-debug.png</bdi>");
	});

	it("keeps a failed read's name in the counted line, with no meta slot", () => {
		const root = mount(commandsThenRead(true));
		expect({
			meta: root.querySelector("[id$=-meta]"),
			names: root.querySelector("[data-testid=counted-line-names]")?.textContent,
			labelledBy: root
				.querySelector("button[aria-expanded]")
				?.getAttribute("aria-labelledby")
				?.endsWith("-label"),
		}).toStrictEqual({meta: null, names: "Ran 2 commands, read input-debug.png", labelledBy: true});
	});

	it("shows no file link while the sole file's meta carries a stop note", () => {
		const root = mount([
			{id: "t1", name: "Read", input: {file_path: "/r/x.ts"}},
			{id: "t2", name: "Edit", input: {file_path: "/r/x.ts"}, isError: true, denialKind: "user-rejected"},
		]);
		expect({
			meta: root.querySelector("[id$=-meta]"),
			label: root.querySelector("[id$=-label]")?.textContent,
		}).toStrictEqual({meta: null, label: "Read and edited x.ts (1 stopped)"});
	});
});

describe("in-flight tool rows", () => {
	const poll = {
		id: "p",
		name: "Bash",
		input: {command: "gh pr view 1954", description: "Poll PR #1954 for new activity from Don or Moh"},
	};

	it("shimmers a pending single row with its progressive label in ShimmerText", () => {
		const html = renderRun([{...poll, pending: true}]).replaceAll(/ id="[^"]*"/g, "");
		expect(html).toContain(
			'<span data-cds="ShimmerText" data-shimmering="true" data-variant="secondary" class="relative truncate min-w-0 text-body">Polling PR #1954 for new activity from Don or Moh<span data-cds-shimmer-clone="" aria-hidden="true" data-find-omitted="" inert="">Polling PR #1954 for new activity from Don or Moh</span></span>',
		);
	});

	it("switches a resolved row back to the muted done label", () => {
		const html = renderRun([poll]);
		expect({
			shimmer: html.includes("ShimmerText"),
			done: html.includes(">Polled PR #1954 for new activity from Don or Moh<"),
		}).toStrictEqual({
			shimmer: false,
			done: true,
		});
	});

	it("labels a pending group row with the in-flight call's progressive label", () => {
		const html = renderRun([
			{id: "r", name: "Read", input: {file_path: "/a/x.ts"}},
			{...poll, pending: true},
		]);
		const button = summaryButton(html).replaceAll(/ id="[^"]*"/g, "");
		expect(button).toContain(
			'<span data-cds="ShimmerText" data-shimmering="true" data-variant="secondary" class="relative text-body truncate min-w-0">Polling PR #1954 for new activity from Don or Moh<span data-cds-shimmer-clone="" aria-hidden="true" data-find-omitted="" inert="">Polling PR #1954 for new activity from Don or Moh</span></span>',
		);
	});
});
