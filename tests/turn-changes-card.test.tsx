// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {registerPane} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {SessionChat} from "../src/components/session-chat";
import {SettingsProvider} from "../src/components/settings-provider";
import {TurnChangesCard} from "../src/components/turn-changes-card";
import {TurnUndoSendContext} from "../src/components/turn-undo-send-context";
import {fileViewerPath} from "../src/lib/api/file";
import {CHANGES_SCOPE_REQUEST_EVENT} from "../src/lib/changes-scope-request";
import {loadChangesScope} from "../src/lib/pane-layout";
import {processTranscript} from "../src/lib/transcript";
import {TOUCH_REVEAL} from "../src/lib/touch-reveal";
import {aggregateTurnEdits, collectTurnChanges, isScratchpadPath, type TurnChanges} from "../src/lib/turn-changes";
import {installLocalStorage} from "./fake-storage";

vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

class FakeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal("ResizeObserver", FakeObserver);
	vi.stubGlobal("IntersectionObserver", FakeObserver);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn<() => void>(),
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("aggregateTurnEdits", () => {
	it("sums each file's stats across calls in first-edit order, skipping failed and non-edit calls", () => {
		const summary = aggregateTurnEdits([
			{
				name: "Edit",
				input: {file_path: "/repo/src/b.ts", old_string: "one\ntwo", new_string: "one\n2"},
			},
			{name: "Write", input: {file_path: "/repo/src/a.ts", content: "x\ny\nz"}},
			{name: "Read", input: {file_path: "/repo/src/c.ts"}},
			{
				name: "Edit",
				input: {file_path: "/repo/src/b.ts", old_string: "three", new_string: "3\n4"},
			},
			{
				name: "Edit",
				input: {file_path: "/repo/src/d.ts", old_string: "a", new_string: "b"},
				isError: true,
			},
			{
				name: "MultiEdit",
				input: {
					file_path: "/repo/src/a.ts",
					edits: [
						{old_string: "x", new_string: "X"},
						{old_string: "y\nz", new_string: ""},
					],
				},
			},
			{
				name: "NotebookEdit",
				input: {notebook_path: "/repo/nb.ipynb", new_source: "print(1)\nprint(2)"},
			},
		]);

		expect(summary).toStrictEqual({
			files: [
				{path: "/repo/src/b.ts", added: 3, removed: 2},
				{path: "/repo/src/a.ts", added: 4, removed: 3},
				{path: "/repo/nb.ipynb", added: 2, removed: 0},
			],
			added: 9,
			removed: 5,
		});
	});

	it("sums a Write and a Write update that both carry result patches (Hello2 shape)", () => {
		const summary = aggregateTurnEdits([
			{
				name: "Write",
				input: {file_path: "/repo/plan.md", content: "x"},
				hasResult: true,
				resultMeta: {writeType: "create", patchStats: {added: 10, removed: 0}},
			},
			{
				name: "Write",
				input: {file_path: "/repo/plan.md", content: "y"},
				hasResult: true,
				resultMeta: {writeType: "update", patchStats: {added: 3, removed: 3}},
			},
		]);
		expect(summary).toStrictEqual({files: [{path: "/repo/plan.md", added: 13, removed: 3}], added: 13, removed: 3});
	});

	it("adds an Edit's stats after a Write of the same file", () => {
		const summary = aggregateTurnEdits([
			{name: "Write", input: {file_path: "/repo/x.md", content: "1\n2\n3\n4\n5"}, hasResult: true},
			{
				name: "Edit",
				input: {file_path: "/repo/x.md", old_string: "1\n2", new_string: "one"},
				hasResult: true,
			},
		]);
		expect(summary).toStrictEqual({files: [{path: "/repo/x.md", added: 6, removed: 2}], added: 6, removed: 2});
	});

	it("skips a pending call that has no result yet", () => {
		const summary = aggregateTurnEdits([
			{name: "Edit", input: {file_path: "/repo/x.md", old_string: "a", new_string: "b"}, hasResult: false},
		]);
		expect(summary).toStrictEqual({files: [], added: 0, removed: 0});
	});

	it("skips edits in the Claude Code scratchpad", () => {
		const summary = aggregateTurnEdits([
			{
				name: "Write",
				input: {
					file_path: "/private/tmp/claude-501/-Users-x/0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6/scratchpad/a.txt",
					content: "hi",
				},
				hasResult: true,
			},
			{
				name: "Write",
				input: {
					file_path: "/tmp/claude-501/-Users-x/0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6/scratchpad",
					content: "hi",
				},
				hasResult: true,
			},
		]);
		expect(summary).toStrictEqual({files: [], added: 0, removed: 0});
	});

	it("skips edits in a project memory dir", () => {
		const summary = aggregateTurnEdits([
			{
				name: "Write",
				input: {file_path: "/Users/x/.claude/projects/p/memory/m.md", content: "hi"},
				hasResult: true,
			},
		]);
		expect(summary).toStrictEqual({files: [], added: 0, removed: 0});
	});

	it("counts a scratchpad-looking path with dot segments", () => {
		const path = "/private/tmp/claude-501/x/../scratchpad/a";
		const summary = aggregateTurnEdits([{name: "Write", input: {file_path: path, content: "hi"}, hasResult: true}]);
		expect(summary).toStrictEqual({files: [{path, added: 1, removed: 0}], added: 1, removed: 0});
	});
});

describe("isScratchpadPath", () => {
	it("matches upstream $M on POSIX and Windows scratchpads and rejects dot segments", () => {
		const uuid = "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6";
		expect(
			[
				`/private/tmp/claude-501/-Users-x/${uuid}/scratchpad/a.txt`,
				`/tmp/claude-501/-Users-x/${uuid}/scratchpad`,
				`/tmp/claude-501/-Users-x/${uuid}/scratchpadx`,
				`/tmp/claude-501/-Users-x/not-a-uuid/scratchpad/a`,
				`/tmp/claude-501/-Users-x/${uuid}/scratchpad/../a`,
				`C:\\Users\\me\\AppData\\Local\\Temp\\claude\\C--repo\\${uuid}\\scratchpad\\a.txt`,
			].map(isScratchpadPath),
		).toStrictEqual([true, true, false, false, false, true]);
	});
});

const EDIT_RECORDS = [
	{type: "user", uuid: "u-1", message: {role: "user", content: "Fabricated request"}},
	{
		type: "assistant",
		uuid: "a-1",
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tool-1",
					name: "Edit",
					input: {file_path: "/repo/src/cache.ts", old_string: "old", new_string: "new\nline"},
				},
			],
		},
	},
	{
		type: "user",
		uuid: "r-1",
		sourceToolAssistantUUID: "a-1",
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: "tool-1", content: "ok"}],
		},
	},
	{
		type: "assistant",
		uuid: "a-2",
		message: {
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tool-2",
					name: "Write",
					input: {file_path: "/repo/src/index.ts", content: "export {};"},
				},
			],
		},
	},
	{
		type: "user",
		uuid: "r-2",
		sourceToolAssistantUUID: "a-2",
		message: {
			role: "user",
			content: [{type: "tool_result", tool_use_id: "tool-2", content: "ok"}],
		},
	},
	{
		type: "assistant",
		uuid: "a-3",
		message: {role: "assistant", content: [{type: "text", text: "Fabricated final answer"}]},
	},
	{type: "user", uuid: "u-2", message: {role: "user", content: "Fabricated follow-up"}},
	{
		type: "assistant",
		uuid: "a-4",
		message: {role: "assistant", content: [{type: "text", text: "Fabricated reply"}]},
	},
];

type TurnStep =
	| {text: string}
	| {tool: string; id: string; input: Record<string, unknown>; result?: string; toolUseResult?: unknown};

/** One prompt-to-prompt turn: each step is its own assistant line, each tool answered with its result. */
function turnRecords(steps: TurnStep[], prefix = "t"): unknown[] {
	const records: unknown[] = [
		{type: "user", uuid: `${prefix}-u`, message: {role: "user", content: "Fabricated request"}},
	];
	for (const [index, step] of steps.entries()) {
		const uuid = `${prefix}-a${index}`;
		if ("text" in step) {
			records.push({
				type: "assistant",
				uuid,
				message: {role: "assistant", content: [{type: "text", text: step.text}]},
			});
			continue;
		}
		records.push(
			{
				type: "assistant",
				uuid,
				message: {
					role: "assistant",
					content: [{type: "tool_use", id: step.id, name: step.tool, input: step.input}],
				},
			},
			{
				type: "user",
				uuid: `${prefix}-r${index}`,
				sourceToolAssistantUUID: uuid,
				message: {
					role: "user",
					content: [{type: "tool_result", tool_use_id: step.id, content: step.result ?? "ok"}],
				},
				...(step.toolUseResult === undefined ? {} : {toolUseResult: step.toolUseResult}),
			},
		);
	}
	return records;
}

/** Hello2's last turn (session_01KwfEs1RD2zvBHuES114CNb): the plan file rewritten, then a stopped ExitPlanMode. */
const HELLO2_LAST_TURN: TurnStep[] = [
	{
		tool: "Write",
		id: "plan-write",
		input: {
			file_path: "/Users/x/.claude/plans/this-is-a-test-glistening-pike.md",
			content: "# Plan\n\nOne\nTwo\nThree\nFour",
		},
		toolUseResult: {
			type: "update",
			filePath: "/Users/x/.claude/plans/this-is-a-test-glistening-pike.md",
			content: "# Plan\n\nOne\nTwo\nThree\nFour",
			originalFile: "# Plan\n\nA\nB\nC\nD",
			structuredPatch: [
				{
					oldStart: 3,
					oldLines: 4,
					newStart: 3,
					newLines: 4,
					lines: ["-A", "-B", "-C", "-D", "+One", "+Two", "+Three", "+Four"],
				},
			],
		},
	},
	{tool: "ExitPlanMode", id: "plan-exit", input: {plan: "# Plan"}, result: "Fabricated plan stopped"},
];

describe("collectTurnChanges", () => {
	it("anchors each editing turn on its last assistant text and skips turns without edits", () => {
		const {lines, toolResultMap} = processTranscript(EDIT_RECORDS, 0);
		const changes = collectTurnChanges(lines, toolResultMap);

		expect([...changes.entries()]).toStrictEqual([
			[
				5,
				{
					turnUuid: "u-1",
					anchorLineIndex: 5,
					files: [
						{path: "/repo/src/cache.ts", added: 2, removed: 1},
						{path: "/repo/src/index.ts", added: 1, removed: 0},
					],
					added: 3,
					removed: 1,
					soleVisibleEditToolRow: false,
				},
			],
		]);
	});

	const editA = (id: string): TurnStep => ({
		tool: "Edit",
		id,
		input: {file_path: "/repo/a.ts", old_string: "old", new_string: "new"},
	});
	const anchors = (steps: TurnStep[], options?: Parameters<typeof collectTurnChanges>[2]) => {
		const {lines, toolResultMap} = processTranscript(turnRecords(steps), 0);
		return [...collectTurnChanges(lines, toolResultMap, options).values()].map((change) => ({
			files: change.files.map((file) => file.path),
			sole: change.soleVisibleEditToolRow,
		}));
	};

	it("leaves out a turn whose only edit is one completed Write", () => {
		expect(anchors([{tool: "Write", id: "w", input: {file_path: "/repo/a.ts", content: "x"}}])).toStrictEqual([]);
	});

	it("leaves out Hello2's last turn: a plan Write and a standalone ExitPlanMode", () => {
		expect(anchors(HELLO2_LAST_TURN)).toStrictEqual([]);
	});

	it("leaves out two same-file Edits in one run, which upstream draws as one bare row", () => {
		expect(anchors([editA("e1"), editA("e2")])).toStrictEqual([]);
	});

	it("keeps the card for one file edited in two runs split by prose", () => {
		expect(anchors([editA("e1"), {text: "Fabricated progress note"}, editA("e2")])).toStrictEqual([
			{files: ["/repo/a.ts"], sole: false},
		]);
	});

	it("keeps the card when the edit's run is not bare", () => {
		expect([
			anchors([{tool: "Read", id: "r", input: {file_path: "/repo/a.ts"}}, editA("e1")]),
			anchors([editA("e1"), {tool: "Bash", id: "b", input: {command: "ls"}}]),
		]).toStrictEqual([[{files: ["/repo/a.ts"], sole: false}], [{files: ["/repo/a.ts"], sole: false}]]);
	});

	it("keeps the card for two files", () => {
		expect(
			anchors([editA("e1"), {tool: "Write", id: "w", input: {file_path: "/repo/b.ts", content: "x"}}]),
		).toStrictEqual([{files: ["/repo/a.ts", "/repo/b.ts"], sole: false}]);
	});

	it("keeps a sole bare edit's card with tools hidden, where no row carries the edit", () => {
		expect(
			anchors([{tool: "Write", id: "w", input: {file_path: "/repo/a.ts", content: "x"}}], {showTools: false}),
		).toStrictEqual([{files: ["/repo/a.ts"], sole: true}]);
	});

	it("leaves out a turn that is still in progress, but not earlier finished turns", () => {
		const steps: TurnStep[] = [editA("e1"), {tool: "Bash", id: "b", input: {command: "ls"}}];
		const {lines, toolResultMap} = processTranscript([...turnRecords(steps, "t1"), ...turnRecords(steps, "t2")], 0);
		const turns = (turnInProgress: boolean) =>
			[...collectTurnChanges(lines, toolResultMap, {turnInProgress}).values()].map((change) => change.turnUuid);
		expect({finished: turns(false), inProgress: turns(true)}).toStrictEqual({
			finished: ["t1-u", "t2-u"],
			inProgress: ["t1-u"],
		});
	});
});

describe("SessionChat end-of-turn card", () => {
	it("draws no card for Hello2's last turn, whose plan Write is a sole bare edit row", () => {
		const {lines, toolResultMap} = processTranscript(turnRecords(HELLO2_LAST_TURN), 0);
		const {container} = render(
			<SettingsProvider>
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					shouldScrollToEnd={false}
				/>
			</SettingsProvider>,
		);
		expect(container.querySelectorAll("[data-turn-changes-card]").length).toBe(0);
	});

	it("still shows Hello2's +4 −4 on the turn's row after the card is dropped", () => {
		const {lines, toolResultMap} = processTranscript(turnRecords(HELLO2_LAST_TURN), 0);
		const {container} = render(
			<SettingsProvider>
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					shouldScrollToEnd={false}
				/>
			</SettingsProvider>,
		);
		expect([...container.querySelectorAll("[data-diff-stat-pill]")].map((pill) => pill.textContent)).toStrictEqual([
			"+4−44 added, 4 removed",
		]);
	});

	it("renders the card inside the turn's final text entry", () => {
		const {lines, toolResultMap} = processTranscript(EDIT_RECORDS, 0);
		const {container} = render(
			<SettingsProvider>
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					shouldScrollToEnd={false}
				/>
			</SettingsProvider>,
		);

		const cards = [...container.querySelectorAll("[data-turn-changes-card]")].map((card) => ({
			entry: card.closest("[data-record-index]")?.getAttribute("data-record-index"),
			text: card.textContent,
		}));
		expect(cards).toStrictEqual([{entry: "5", text: "Edited 2 filesUndocache.ts+2−1index.ts+1−0See all+3−1"}]);
	});
});

function changesWith(fileCount: number): TurnChanges {
	const files = Array.from({length: fileCount}, (_, index) => ({
		path: `/repo/src/file-${index + 1}.ts`,
		added: index + 1,
		removed: 1,
	}));
	return {
		turnUuid: "u-1",
		anchorLineIndex: 5,
		files,
		added: files.reduce((sum, file) => sum + file.added, 0),
		removed: fileCount,
		soleVisibleEditToolRow: false,
	};
}

function fileRowNames(): string[] {
	return screen.getAllByRole("link").map((link) => link.textContent);
}

describe("TurnChangesCard", () => {
	it("caps the list at four rows and expands with Show N more", () => {
		render(<TurnChangesCard sessionId="test-session" changes={changesWith(6)} />);
		const before = fileRowNames();
		const more = screen.getByRole("button", {name: "Show 2 more"});
		const expandedBefore = more.getAttribute("aria-expanded");
		fireEvent.click(more);

		expect({
			before,
			expandedBefore,
			after: fileRowNames(),
			moreAfter: screen.queryByRole("button", {name: /Show \d+ more/}),
		}).toStrictEqual({
			before: ["file-1.ts+1−1", "file-2.ts+2−1", "file-3.ts+3−1", "file-4.ts+4−1"],
			expandedBefore: "false",
			after: [
				"file-1.ts+1−1",
				"file-2.ts+2−1",
				"file-3.ts+3−1",
				"file-4.ts+4−1",
				"file-5.ts+5−1",
				"file-6.ts+6−1",
			],
			moreAfter: null,
		});
	});

	it("draws a single file as upstream's outlined card with no header, its row 44px below the previous row", () => {
		const {container} = render(<TurnChangesCard sessionId="test-session" changes={changesWith(1)} />);
		const card = container.querySelector<HTMLElement>("[data-turn-changes-card]")!;
		const item = screen.getByRole("listitem");
		const undo = within(card).getByRole("button", {name: "Undo"});
		const classes = (element: Element, names: string[]) => names.filter((name) => element.classList.contains(name));
		expect({
			header: screen.queryByText(/^Edited/),
			list: screen.getByRole("list").getAttribute("aria-label"),
			rows: [item.textContent],
			links: fileRowNames(),
			more: screen.queryByRole("button", {name: /Show \d+ more/}),
			card: classes(card, [
				"mt-2",
				"mt-5",
				"mt-4",
				"mb-[11px]",
				"mb-[7px]",
				"px-2",
				"py-1",
				"rounded-r6",
				"shadow-[inset_0_0_0_1px_var(--color-border)]",
			]),
			item: classes(item, ["-mx-1", "px-1", "gap-1"]),
			icon: Array.from(item.querySelectorAll("svg.lucide"), (icon) => classes(icon, ["lucide-code", "size-4"])),
			trailing: Array.from(item.children, (child) => child.tagName === "SPAN" && child.textContent),
			chevron: item.querySelector(":scope > span > span.text-secondary > svg") !== null,
			undoRevealedOnHover: ["sr-only", "group-hover/card:not-sr-only", "focus-visible:not-sr-only"].every(
				(name) => undo.classList.contains(name),
			),
		}).toStrictEqual({
			header: null,
			list: "Edited 1 file",
			rows: ["file-1.ts+1\u22121Undo"],
			links: ["file-1.ts"],
			more: null,
			card: ["mt-4", "mb-[7px]", "px-2", "py-1", "rounded-r6", "shadow-[inset_0_0_0_1px_var(--color-border)]"],
			item: ["-mx-1", "px-1", "gap-1"],
			icon: [["lucide-code", "size-4"]],
			trailing: [false, "+1\u22121", false],
			chevron: true,
			undoRevealedOnHover: true,
		});
	});

	it('tooltips the single-file row "View this turn\'s changes" inside a pane host, as upstream', () => {
		vi.useFakeTimers();
		try {
			render(
				<SettingsProvider>
					<TileHost sessionId="turn-card-tooltip" onExpandWithoutPane={() => {}}>
						<TurnChangesCard sessionId="turn-card-tooltip" changes={changesWith(1)} />
					</TileHost>
				</SettingsProvider>,
			);
			const row = screen.getByRole("button", {name: /^file-1\.ts/});
			fireEvent.pointerEnter(row.parentElement!);
			act(() => {
				vi.advanceTimersByTime(400);
			});
			expect({
				tooltip: screen.queryByRole("tooltip")?.textContent,
				title: row.getAttribute("title"),
			}).toStrictEqual({
				tooltip: "View this turn's changes",
				title: null,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("reveals each row's hover-only chevron on touch", () => {
		render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} />);
		const chevrons = screen.getAllByRole("link").map((link) => link.querySelector("svg:last-of-type"));

		expect(chevrons.map((chevron) => chevron?.getAttribute("class")?.includes(TOUCH_REVEAL))).toStrictEqual([
			true,
			true,
		]);
	});

	it("keeps the multi-file header and its 8px top margin", () => {
		const {container} = render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} />);
		const card = container.querySelector<HTMLElement>("[data-turn-changes-card]")!;
		expect({
			header: screen.getByText("Edited 2 files").textContent,
			spacing: ["mt-2", "mt-5", "mb-[11px]"].filter((name) => card.classList.contains(name)),
		}).toStrictEqual({header: "Edited 2 files", spacing: ["mt-2"]});
	});

	it("uses upstream's U+2212 minus in the row stats and the closing See all totals", () => {
		const {container} = render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} />);
		expect(container.querySelector("[data-turn-changes-card]")?.textContent).toBe(
			"Edited 2 filesUndofile-1.ts+1\u22121file-2.ts+2\u22121See all+3\u22122",
		);
	});

	it("draws upstream's summary card: inset ring, 10px radius, 13/19 rows with 16px icons and 12/15 git stats", () => {
		const {container} = render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} />);
		const card = container.querySelector<HTMLElement>("[data-turn-changes-card]")!;
		const [row] = screen.getAllByRole("link");
		const pick = (element: Element | null | undefined, names: string[]) =>
			names.filter((name) => element?.classList.contains(name) === true);

		expect({
			card: pick(card, [
				"rounded-r7",
				"px-2",
				"py-1.5",
				"gap-1",
				"select-text",
				"shadow-[inset_0_0_0_1px_var(--color-border)]",
			]),
			title: pick(screen.getByText("Edited 2 files"), ["text-[13px]/[19px]", "text-primary"]),
			icon: pick(row?.querySelector("svg"), ["size-4"]),
			name: pick(within(row!).getByText("file-1.ts"), ["text-[13px]/[19px]"]),
			stats: pick(within(row!).getByText("+1").parentElement, ["text-[12px]/[15px]"]),
			seeAll: within(card).getByText("See all").className,
		}).toStrictEqual({
			card: [
				"rounded-r7",
				"px-2",
				"py-1.5",
				"gap-1",
				"select-text",
				"shadow-[inset_0_0_0_1px_var(--color-border)]",
			],
			title: ["text-[13px]/[19px]", "text-primary"],
			icon: ["size-4"],
			name: ["text-[13px]/[19px]"],
			stats: ["text-[12px]/[15px]"],
			seeAll: "text-[13px]/[19px] text-primary",
		});
	});

	it("links each file row to the file viewer", () => {
		render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} />);
		expect(
			screen.getAllByRole("link").map((link) => ({
				href: link.getAttribute("href"),
				title: link.getAttribute("title"),
			})),
		).toStrictEqual([
			{href: fileViewerPath("/repo/src/file-1.ts"), title: "/repo/src/file-1.ts"},
			{href: fileViewerPath("/repo/src/file-2.ts"), title: "/repo/src/file-2.ts"},
		]);
	});

	it("opens the Changes pane scoped to the turn from the header", () => {
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
			DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
		);
		const unregister = registerPane("changes", {
			title: "Changes",
			render: () => <div data-testid="changes-pane">Changes pane</div>,
		});
		const requests: unknown[] = [];
		const listener = (event: Event) => requests.push((event as CustomEvent).detail);
		window.addEventListener(CHANGES_SCOPE_REQUEST_EVENT, listener);
		try {
			render(
				<SettingsProvider>
					<TileHost sessionId="turn-card-session" onExpandWithoutPane={() => {}}>
						<TurnChangesCard sessionId="turn-card-session" changes={changesWith(2)} />
					</TileHost>
				</SettingsProvider>,
			);
			const before = screen.queryByTestId("changes-pane");
			const card = screen.getByRole("list", {name: "Edited 2 files"}).parentElement!;
			act(() => {
				fireEvent.click(within(card).getByRole("button", {name: /^Edited 2 files/}));
			});
			const seeAll = within(card.parentElement!).getByRole("button", {name: /^See all/});

			expect({
				before,
				opened: screen.queryByTestId("changes-pane")?.textContent,
				scope: loadChangesScope("turn-card-session"),
				requests,
			}).toStrictEqual({
				before: null,
				opened: "Changes pane",
				scope: "turn:u-1",
				requests: [{sessionId: "turn-card-session", scope: "turn:u-1"}],
			});
			act(() => {
				fireEvent.click(seeAll);
			});
			expect(requests).toHaveLength(2);
		} finally {
			window.removeEventListener(CHANGES_SCOPE_REQUEST_EVENT, listener);
			unregister();
		}
	});

	it("opens the Changes pane scoped to the turn from a single-file row", () => {
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
			DOMRect.fromRect({x: 0, y: 0, width: 1200, height: 800}),
		);
		const unregister = registerPane("changes", {
			title: "Changes",
			render: () => <div data-testid="changes-pane">Changes pane</div>,
		});
		try {
			render(
				<SettingsProvider>
					<TileHost sessionId="turn-card-single" onExpandWithoutPane={() => {}}>
						<TurnChangesCard sessionId="turn-card-single" changes={changesWith(1)} />
					</TileHost>
				</SettingsProvider>,
			);
			act(() => {
				fireEvent.click(screen.getByRole("button", {name: /^file-1\.ts/}));
			});
			expect({
				opened: screen.queryByTestId("changes-pane")?.textContent,
				scope: loadChangesScope("turn-card-single"),
			}).toStrictEqual({opened: "Changes pane", scope: "turn:u-1"});
		} finally {
			unregister();
		}
	});

	it("renders a static header outside a pane host", () => {
		render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} />);
		expect(screen.queryByRole("button", {name: /^Edited/})).toBeNull();
	});
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {"Content-Type": "application/json"},
	});
}

interface FetchCall {
	url: string;
	method: string;
	body: unknown;
}

function stubFetch(responses: Response[]): FetchCall[] {
	const calls: FetchCall[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({
				url,
				method: init?.method ?? "GET",
				body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
			});
			const next = responses.shift();
			if (next === undefined) return Promise.reject(new Error(`Unexpected fetch ${url}`));
			return Promise.resolve(next);
		}),
	);
	return calls;
}

const READY_PREVIEW = {
	files: [
		{path: "/repo/src/file-1.ts", status: "modified", state: "ready"},
		{path: "/repo/src/file-2.ts", status: "added", state: "ready"},
	],
};

describe("TurnChangesCard Undo", () => {
	it("Undo sends the undo prompt when the session has a live pane", () => {
		const calls = stubFetch([]);
		const send = vi.fn<(text: string) => void>();
		render(
			<TurnUndoSendContext.Provider value={send}>
				<TurnChangesCard sessionId="s-1" changes={changesWith(2)} />
			</TurnUndoSendContext.Provider>,
		);

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));

		expect({
			sent: send.mock.calls,
			calls,
			dialog: screen.queryByRole("alertdialog"),
			undoDisabled: screen.getByRole("button", {name: "Undo"}).hasAttribute("disabled"),
		}).toStrictEqual({
			sent: [
				[
					[
						"Undo the changes you made to these 2 files in your last turn and restore them to their previous state:",
						"- `/repo/src/file-1.ts`",
						"- `/repo/src/file-2.ts`",
					].join("\n"),
				],
			],
			calls: [],
			dialog: null,
			undoDisabled: false,
		});
	});

	it("Undo on a one-file card sends the one-file prompt", () => {
		const send = vi.fn<(text: string) => void>();
		render(
			<TurnUndoSendContext.Provider value={send}>
				<TurnChangesCard sessionId="s-1" changes={changesWith(1)} />
			</TurnUndoSendContext.Provider>,
		);

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));

		expect(send.mock.calls).toStrictEqual([
			[
				"Undo the changes you made to `/repo/src/file-1.ts` in your last turn and restore it to its previous state.",
			],
		]);
	});

	it("lists the files in a confirm dialog and reverts them on confirm", async () => {
		const calls = stubFetch([
			jsonResponse(READY_PREVIEW),
			jsonResponse({reverted: ["/repo/src/file-1.ts", "/repo/src/file-2.ts"]}),
		]);
		render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} />);

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));
		const dialog = await screen.findByRole("alertdialog");
		const listed = within(dialog)
			.getAllByRole("listitem")
			.map((item) => item.textContent);
		fireEvent.click(within(dialog).getByRole("button", {name: "Undo changes"}));
		const status = await screen.findByText("Reverted 2 files");

		expect({title: within(dialog).getByRole("heading").textContent, listed, calls}).toStrictEqual({
			title: "Undo changes from this turn?",
			listed: ["file-1.ts", "file-2.ts"],
			calls: [
				{url: "/api/sessions/s-1/turn-undo?turn=u-1", method: "GET", body: null},
				{
					url: "/api/sessions/s-1/turn-undo",
					method: "POST",
					body: {turn: "u-1", confirm: true},
				},
			],
		});
		expect(status.textContent).toBe("Reverted 2 files");
	});

	it("writes nothing when the dialog is cancelled", async () => {
		const calls = stubFetch([jsonResponse(READY_PREVIEW)]);
		render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} />);

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));
		const dialog = await screen.findByRole("alertdialog");
		fireEvent.click(within(dialog).getByRole("button", {name: "Cancel"}));

		expect(calls.map((call) => call.method)).toStrictEqual(["GET"]);
	});

	it("refuses without a dialog when files changed since the turn", async () => {
		const calls = stubFetch([
			jsonResponse({
				files: [
					{path: "/repo/src/file-1.ts", status: "modified", state: "conflict"},
					{path: "/repo/src/file-2.ts", status: "added", state: "ready"},
				],
			}),
		]);
		render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} />);

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));
		const alert = await screen.findByRole("alert");

		expect({
			alert: alert.textContent,
			dialog: screen.queryByRole("alertdialog"),
			methods: calls.map((call) => call.method),
		}).toStrictEqual({
			alert: "Can't undo: file-1.ts changed since this turn.",
			dialog: null,
			methods: ["GET"],
		});
	});
});
