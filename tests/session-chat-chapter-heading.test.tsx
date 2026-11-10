// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {addUserChapter, readSessionChapters, renameChapter, setChapterHidden} from "../src/lib/chapter-store";
import {processTranscript} from "../src/lib/transcript";
import {ESTIMATED_TURN_HEIGHT_PIXELS, estimatedRowHeight} from "../src/lib/transcript-row-estimate";
import type {TranscriptMode} from "../src/lib/transcript-mode";
import {installLocalStorage} from "./fake-storage";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({
		settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
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
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	installLocalStorage();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const prompt = {
	type: "user",
	uuid: "u-prompt",
	message: {role: "user", content: "Fabricated request"},
};

interface Call {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	/** Extra fields on the result record, such as `toolDenialKind`. */
	resultRecord?: Record<string, unknown>;
}

function call({id, name, input, result, isError, resultRecord}: Call): unknown[] {
	const assistant = {
		type: "assistant",
		uuid: `a-${id}`,
		message: {id: `msg-${id}`, role: "assistant", content: [{type: "tool_use", id, name, input}]},
	};
	if (result === undefined) return [assistant];
	return [
		assistant,
		{
			type: "user",
			uuid: `r-${id}`,
			...resultRecord,
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: id,
						content: result,
						...(isError === true ? {is_error: true} : {}),
					},
				],
			},
		},
	];
}

const read = (id: string): Call => ({
	id,
	name: "Read",
	input: {file_path: `/fabricated/${id}.ts`},
	result: "1\tconst fabricated = true;",
});

const chapter = (result: string, isError = false, title: unknown = "Staging refinement nodes"): Call => ({
	id: "toolu_ch1",
	name: "mcp__ccd_session__mark_chapter",
	input: {title, summary: "Analyzed 5 inbox items"},
	result,
	isError,
});

const MARKED = 'Chapter marked: "Staging refinement nodes". Continue your current work.';

function rows(
	records: unknown[],
	{mode = "normal", showTools = true}: {mode?: TranscriptMode; showTools?: boolean} = {},
) {
	const {lines, toolResultMap} = processTranscript(records);
	const {container} = render(
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			transcriptMode={mode}
			showTools={showTools}
			showThinking={false}
			shouldScrollToEnd={false}
		/>,
	);
	const observed = Array.from(container.querySelectorAll<HTMLElement>("[data-transcript-entry-index]")).map(
		(row) => ({
			perfRow: row.dataset["perfRow"],
			tools: Array.from(
				row.querySelectorAll('[data-tool-row] > [role="button"], [data-tool-row] > button'),
				(element) => element.textContent,
			),
			headings: Array.from(row.querySelectorAll("h3[id^='epitaxy-ch-']"), (h3) => `${h3.id} ${h3.textContent}`),
		}),
	);
	const text = container.textContent;
	cleanup();
	return {observed, mentionsMcpRow: text.includes("mark chapter")};
}

const human = {perfRow: "human", tools: [], headings: []};
const tool = (labels: string[]) => ({perfRow: "assistant_tool", tools: labels, headings: []});
const heading = {
	perfRow: "assistant_other",
	tools: [],
	headings: ["epitaxy-ch-toolu_ch1 Staging refinement nodes"],
};

describe("a mark_chapter call draws as a chapter heading, not a tool row", () => {
	it("lifts the heading out of the tool run, splitting the reads around it", () => {
		const records = [prompt, ...call(read("one")), ...call(chapter(MARKED)), ...call(read("two"))];
		const expected = {
			observed: [human, tool(["Readone.ts"]), heading, tool(["Readtwo.ts"])],
			mentionsMcpRow: false,
		};
		expect({normal: rows(records), verbose: rows(records, {mode: "verbose"})}).toStrictEqual({
			normal: expected,
			verbose: expected,
		});
	});

	it("swallows a call with an empty title: no heading and no tool row", () => {
		const records = [prompt, ...call(read("one")), ...call(chapter(MARKED, false, "  ")), ...call(read("two"))];
		expect(rows(records)).toStrictEqual({
			observed: [human, tool(["Read 2 files"])],
			mentionsMcpRow: false,
		});
	});

	it("draws an errored call as a lone failed tool row with no heading", () => {
		const records = [prompt, ...call(read("one")), ...call(chapter("boom", true)), ...call(read("two"))];
		const {observed} = rows(records);
		expect(observed.map(({perfRow, headings, tools}) => ({perfRow, headings, count: tools.length}))).toStrictEqual([
			{perfRow: "human", headings: [], count: 0},
			{perfRow: "assistant_tool", headings: [], count: 1},
			{perfRow: "assistant_tool", headings: [], count: 1},
			{perfRow: "assistant_tool", headings: [], count: 1},
		]);
	});

	it("keeps the heading of an interrupted call and draws no tool row", () => {
		const records = [prompt, ...call(chapter("Tool execution was interrupted.", true))];
		expect(rows(records)).toStrictEqual({observed: [human, heading], mentionsMcpRow: false});
	});

	it("keeps the heading for upstream's other interruptions: the denial kind, the CLI's result and the long notices", () => {
		const stoppedWhileRunning =
			"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed. Correction to the text above: this call was stopped while running, not refused before it ran. It may have run in part or in full, and its changes may have been written. No permission prompt was involved. Work it started elsewhere (a remote command, a background process) may still be running, so check before starting the same work again. The instruction to stop and wait still stands.";
		const interrupted = (result: string, resultRecord: Record<string, unknown> = {}) =>
			rows([prompt, ...call({...chapter(result, true), resultRecord})]);
		const kept = {observed: [human, heading], mentionsMcpRow: false};
		const cases = {
			cancelledKind: interrupted("Example stop notice.", {toolDenialKind: "cancelled"}),
			userRejected: interrupted(
				"The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
				{toolDenialKind: "user-rejected", toolUseResult: "User rejected tool use"},
			),
			stoppedWhileRunning: interrupted(stoppedWhileRunning),
		};
		expect(cases).toStrictEqual({cancelledKind: kept, userRejected: kept, stoppedWhileRunning: kept});
	});

	it("still draws the heading with tools hidden", () => {
		const records = [prompt, ...call(read("one")), ...call(chapter(MARKED))];
		expect(rows(records, {showTools: false})).toStrictEqual({observed: [human, heading], mentionsMcpRow: false});
	});
});

describe("a Claude chapter follows the outline's edits", () => {
	it("draws under the user's rename, and not at all once deleted from the outline", () => {
		const records = [prompt, ...call(chapter(MARKED))];
		renameChapter("test-session", "toolu_ch1", "Renamed in the outline");
		const renamed = rows(records).observed;
		setChapterHidden("test-session", "toolu_ch1", true);

		expect({renamed, hidden: rows(records).observed}).toStrictEqual({
			renamed: [human, {...heading, headings: ["epitaxy-ch-toolu_ch1 Renamed in the outline"]}],
			hidden: [human, {...heading, headings: []}],
		});
	});
});

describe("a pinned message draws its chapter heading above it", () => {
	it("heads the pinned prompt's row with the chapter, renamed in place by double-click", () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue("fake-uuid-1" as ReturnType<typeof crypto.randomUUID>);
		addUserChapter("test-session", "u-prompt", "Kickoff", 0);
		const records = [prompt, ...call(read("one"))];
		const {lines, toolResultMap} = processTranscript(records);
		const {container} = render(
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				showTools
				shouldScrollToEnd={false}
			/>,
		);
		const row = container.querySelector<HTMLElement>("[data-perf-row='human']")!;
		const heading = row.querySelector("h3")!;
		const before = {
			id: heading.id,
			text: heading.textContent,
			leads: row.textContent.startsWith("Kickoff"),
			headings: container.querySelectorAll("h3[id^='epitaxy-ch-']").length,
		};
		fireEvent.doubleClick(heading);
		const input = screen.getByRole("textbox", {name: "Chapter title"});
		fireEvent.change(input, {target: {value: "Opening moves"}});
		act(() => {
			fireEvent.keyDown(input, {key: "Enter"});
		});

		expect({
			before,
			stored: readSessionChapters("test-session"),
			after: container.querySelector("h3[id='epitaxy-ch-uch-fake-uuid-1']")?.textContent,
		}).toStrictEqual({
			before: {id: "epitaxy-ch-uch-fake-uuid-1", text: "Kickoff", leads: true, headings: 1},
			stored: {
				renames: {},
				hidden: [],
				userChapters: [{id: "uch-fake-uuid-1", afterId: "u-prompt", title: "Opening moves", recordIndex: 0}],
			},
			after: "Opening moves",
		});
	});
});

describe("chapter row height estimate", () => {
	it("estimates a chapter row at upstream's 48px and any other row at the turn estimate", () => {
		expect({
			chapter: estimatedRowHeight("assistant_other"),
			tool: estimatedRowHeight("assistant_tool"),
		}).toStrictEqual({chapter: 48, tool: ESTIMATED_TURN_HEIGHT_PIXELS});
	});
});
