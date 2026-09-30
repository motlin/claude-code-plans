// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {summarizeToolCalls, summarizeToolCallStats} from "../src/lib/session-utils";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug: true}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

afterEach(cleanup);

interface FakeCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
	isError?: boolean;
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
	const match = summaryButton(html).match(/<span class="text-body truncate min-w-0">([\s\S]*?)<\/span><\/span>/);
	return (match?.[1] ?? "").replaceAll(/<[^>]+>/g, "");
}

function statSpans(html: string): string[] {
	return [...summaryButton(html).matchAll(/<span class="(text-diff-(?:added|removed))">([^<]*)<\/span>/g)].map(
		(m) => `${m[1]}:${m[2]}`,
	);
}

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
				{verb: "Read", rest: "a.ts"},
				{verb: "edited", rest: "b.ts"},
			],
			added: 1,
			removed: 2,
			failed: 0,
		});
	});

	it("puts the failure count on the first segment when no bash call ran", () => {
		expect(
			summarizeToolCallStats([
				{name: "Read", input: {file_path: "/repo/a.ts"}, isError: true},
				{name: "Grep", input: {pattern: "x"}},
			]),
		).toStrictEqual({
			segments: [
				{verb: "Read", rest: "a.ts (1 failed)"},
				{verb: "searched", rest: "for a pattern"},
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

describe("ToolCallSummary stats and ink", () => {
	it('shows "Ran 3 commands (1 failed)" in the collapsed summary label', () => {
		const html = renderRun([
			{id: "t1", name: "Bash", input: {command: "ls"}},
			{id: "t2", name: "Bash", input: {command: "false"}, isError: true},
			{id: "t3", name: "Bash", input: {command: "pwd"}},
		]);
		expect({label: summaryLabel(html), stats: statSpans(html)}).toStrictEqual({
			label: "Ran 3 commands (1 failed)",
			stats: [],
		});
	});

	it("renders diff stats in a trailing tabular span, separate from the label", () => {
		const html = renderRun([
			{id: "t1", name: "Read", input: {file_path: "/repo/a.ts"}},
			{
				id: "t2",
				name: "Edit",
				input: {file_path: "/repo/b.ts", old_string: "a\nb\nc", new_string: "d"},
			},
		]);
		expect({
			label: summaryLabel(html),
			stats: statSpans(html),
			hasStatsWrapper: summaryButton(html).includes('<span class="flex gap-g1 tabular-nums shrink-0">'),
		}).toStrictEqual({
			label: "Read a.ts, edited b.ts",
			stats: ["text-diff-added:+1", "text-diff-removed:-3"],
			hasStatsWrapper: true,
		});
	});

	it('shows "+0 -28" when only lines were removed', () => {
		const removed = Array.from({length: 28}, (_, i) => `line${i}`).join("\n");
		const html = renderRun([
			{id: "t1", name: "Read", input: {file_path: "/repo/a.ts"}},
			{
				id: "t2",
				name: "Edit",
				input: {file_path: "/repo/b.ts", old_string: removed, new_string: ""},
			},
		]);
		expect(statSpans(html)).toStrictEqual(["text-diff-added:+0", "text-diff-removed:-28"]);
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
