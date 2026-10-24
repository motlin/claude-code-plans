// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
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

function summaryLabel(html: string): string {
	const match = summaryButton(html).match(
		/<span (?:id="[^"]*" )?class="text-body truncate min-w-0">([\s\S]*?)<\/span><\/span>/,
	);
	return (match?.[1] ?? "").replaceAll(/<[^>]+>/g, "");
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
	it("counts failed calls and suffixes the bash segment", () => {
		expect(
			summarizeToolCallStats([
				{name: "Bash", input: {command: "ls"}},
				{name: "Bash", input: {command: "false"}, isError: true},
				{name: "Bash", input: {command: "pwd"}},
			]),
		).toStrictEqual({
			segments: [{verb: "Ran", rest: "3 commands (1 failed)"}],
			added: 0,
			removed: 0,
			failed: 1,
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
			added: 1,
			removed: 2,
			failed: 0,
		});
	});

	it("puts the failure count on the segment that failed", () => {
		expect(
			summarizeToolCallStats([
				{name: "Read", input: {file_path: "/repo/a.ts"}, isError: true},
				{name: "Grep", input: {pattern: "x"}},
			]),
		).toStrictEqual({
			segments: [
				{verb: "Read", rest: "a.ts (1 failed)"},
				{verb: "searched", rest: "code"},
			],
			added: 0,
			removed: 0,
			failed: 1,
		});
	});

	it("renders the plain-text label with failures and trailing stats", () => {
		expect(
			summarizeToolCalls([
				{name: "Bash", input: {command: "ls"}, isError: true},
				{name: "Bash", input: {command: "ls"}},
				{name: "Edit", input: {file_path: "/repo/b.ts", old_string: "a\nb", new_string: ""}},
			]),
		).toBe("ran 2 commands (1 failed), edited b.ts +0 -2");
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
		}).toStrictEqual({text: "Editeda.tsxFailed", stats: []});
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
		).toStrictEqual({text: "Createdx.mjsFailed", stats: []});
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
				'<span class="inline-flex items-center gap-g3 min-w-0 text-ink-muted group-hover/tool:text-secondary">',
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

describe("in-flight tool rows", () => {
	const poll = {
		id: "p",
		name: "Bash",
		input: {command: "gh pr view 1954", description: "Poll PR #1954 for new activity from Don or Moh"},
	};

	it("shimmers a pending single row with its progressive label in ShimmerText", () => {
		const html = renderRun([{...poll, pending: true}]).replaceAll(/ id="[^"]*"/g, "");
		expect(html).toContain(
			'<span data-cds="ShimmerText" data-shimmering="true" dir="auto" class="relative truncate min-w-0 text-body">Polling PR #1954 for new activity from Don or Moh<span data-cds-shimmer-clone="" aria-hidden="true" inert="">Polling PR #1954 for new activity from Don or Moh</span></span>',
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
			'<span data-cds="ShimmerText" data-shimmering="true" dir="auto" class="relative text-body truncate min-w-0">Polling PR #1954 for new activity from Don or Moh<span data-cds-shimmer-clone="" aria-hidden="true" inert="">Polling PR #1954 for new activity from Don or Moh</span></span>',
		);
	});
});
