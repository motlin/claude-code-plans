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

	it("offers Undo only on the last turn's card, and on none when the session is archived", () => {
		const turn = (prefix: string): unknown[] =>
			turnRecords(
				[
					{
						tool: "Edit",
						id: `${prefix}-e1`,
						input: {file_path: "/repo/a.ts", old_string: "a", new_string: "b"},
					},
					{
						tool: "Edit",
						id: `${prefix}-e2`,
						input: {file_path: "/repo/b.ts", old_string: "a", new_string: "b"},
					},
				],
				prefix,
			);
		const {lines, toolResultMap} = processTranscript([...turn("t1"), ...turn("t2")], 0);
		const undoByCard = (archived: boolean) => {
			const {container, unmount} = render(
				<SettingsProvider>
					<SessionChat
						sessionId="test-session"
						lines={lines}
						toolResultMap={toolResultMap}
						shouldScrollToEnd={false}
						archived={archived}
					/>
				</SettingsProvider>,
			);
			const result = [...container.querySelectorAll<HTMLElement>("[data-turn-changes-card]")].map(
				(card) => within(card).queryByRole("button", {name: "Undo"}) !== null,
			);
			unmount();
			return result;
		};
		expect({live: undoByCard(false), archived: undoByCard(true)}).toStrictEqual({
			live: [false, true],
			archived: [false, false],
		});
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
		expect(cards).toStrictEqual([{entry: "5", text: "Edited 2 filescache.ts+2−1index.ts+1−0See all+3−1"}]);
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

function fileRowTexts(): string[] {
	return screen.getAllByRole("link").map((link) => link.closest("li")?.textContent ?? "");
}

describe("TurnChangesCard", () => {
	it("shows three rows, then a See all toggle that opens the Changes pane and expands, and Show less collapses", () => {
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
		const changes = {...changesWith(5), turnUuid: "u-toggle"};
		const tree = (
			<SettingsProvider>
				<TileHost sessionId="toggle-session" onExpandWithoutPane={() => {}}>
					<TurnChangesCard sessionId="toggle-session" changes={changes} undoable />
				</TileHost>
			</SettingsProvider>
		);
		try {
			const {unmount} = render(tree);
			const items = () =>
				within(screen.getByRole("list", {name: "Edited 5 files"}))
					.getAllByRole("listitem")
					.map((item) => item.textContent);
			const toggle = () => screen.getByRole("button", {name: /^(See all|Show less)/});
			const before = {items: items(), expanded: toggle().getAttribute("aria-expanded")};
			act(() => {
				fireEvent.click(toggle());
			});
			const afterOpen = {
				items: items(),
				expanded: toggle().getAttribute("aria-expanded"),
				opened: screen.queryByTestId("changes-pane")?.textContent,
				requests: [...requests],
			};
			unmount();
			render(tree);
			const remounted = items();
			act(() => {
				fireEvent.click(toggle());
			});

			expect({
				before,
				afterOpen,
				remounted,
				afterCollapse: {items: items(), expanded: toggle().getAttribute("aria-expanded"), requests},
			}).toStrictEqual({
				before: {
					items: ["file-1.ts+1\u22121", "file-2.ts+2\u22121", "file-3.ts+3\u22121", "See all+15\u22125"],
					expanded: "false",
				},
				afterOpen: {
					items: [
						"file-1.ts+1\u22121",
						"file-2.ts+2\u22121",
						"file-3.ts+3\u22121",
						"file-4.ts+4\u22121",
						"file-5.ts+5\u22121",
						"Show less+15\u22125",
					],
					expanded: "true",
					opened: "Changes pane",
					requests: [{sessionId: "toggle-session", scope: "turn:u-toggle"}],
				},
				remounted: [
					"file-1.ts+1\u22121",
					"file-2.ts+2\u22121",
					"file-3.ts+3\u22121",
					"file-4.ts+4\u22121",
					"file-5.ts+5\u22121",
					"Show less+15\u22125",
				],
				afterCollapse: {
					items: ["file-1.ts+1\u22121", "file-2.ts+2\u22121", "file-3.ts+3\u22121", "See all+15\u22125"],
					expanded: "false",
					requests: [{sessionId: "toggle-session", scope: "turn:u-toggle"}],
				},
			});
		} finally {
			window.removeEventListener(CHANGES_SCOPE_REQUEST_EVENT, listener);
			unregister();
		}
	});

	it("keeps the closing See all a plain row, with no toggle, at three files", () => {
		render(<TurnChangesCard sessionId="test-session" changes={changesWith(3)} undoable />);

		expect({
			rows: fileRowTexts(),
			toggles: screen.queryAllByRole("button", {expanded: false}).length,
		}).toStrictEqual({rows: ["file-1.ts+1\u22121", "file-2.ts+2\u22121", "file-3.ts+3\u22121"], toggles: 0});
	});

	it("draws a single file as upstream's outlined card with no header: the row, then Undo and the stats", () => {
		render(<TurnChangesCard sessionId="test-session" changes={changesWith(1)} undoable />);
		expect({
			header: screen.queryByText(/^Edited/),
			list: screen.getByRole("list").getAttribute("aria-label"),
			rows: screen.getAllByRole("listitem").map((item) => item.textContent),
			links: fileRowNames(),
			more: screen.queryByRole("button", {name: /Show \d+ more/}),
			icons: Array.from(screen.getByRole("listitem").querySelectorAll("svg.lucide"), (icon) =>
				icon.getAttribute("class"),
			),
		}).toStrictEqual({
			header: null,
			list: "Edited 1 file",
			rows: ["file-1.tsUndo+1\u22121"],
			links: ["file-1.ts"],
			more: null,
			icons: ["lucide lucide-code size-4"],
		});
	});

	it("builds both card forms from upstream's shell, row and trailing classes", () => {
		const CARD = [
			"mt-1",
			"flex",
			"w-full",
			"select-text",
			"flex-col",
			"gap-1",
			"rounded-r7",
			"px-2",
			"py-1",
			"text-[13px]/[19px]",
			"shadow-[inset_0_0_0_1px_var(--color-border)]",
		];
		const ITEM = ["relative", "-mx-1", "flex", "min-w-0", "items-center", "gap-2", "px-2"];
		const CONTROL = [
			"flex",
			"min-h-7",
			"min-w-0",
			"grow",
			"items-center",
			"before:absolute",
			"before:inset-0",
			"before:rounded-r5",
			"before:content-['']",
			"text-start",
			"hover:before:bg-fill-ghost-hover",
			"focus-visible:before:shadow-focus",
			"focus-visible:outline-hidden",
		];
		const TRAILING = ["pointer-events-none", "relative", "flex", "shrink-0", "items-center", "gap-1"];
		const shape = (files: number) => {
			const {container, unmount} = render(
				<TurnChangesCard sessionId="test-session" changes={changesWith(files)} undoable />,
			);
			const card = container.querySelector<HTMLElement>("[data-turn-changes-card]")!;
			const [item] = within(card).getAllByRole("listitem");
			const control = within(item!).getByRole("link");
			const trailing = item!.lastElementChild!;
			const result = {
				card: card.className.split(" "),
				item: item!.className.split(" "),
				control: control.className.split(" "),
				trailing: trailing.className.split(" "),
				trailingParts: Array.from(trailing.children, (child) => [child.className, child.textContent]),
				chevrons: card.querySelectorAll(".lucide-chevron-right, [data-chevron]").length,
			};
			unmount();
			return result;
		};

		expect({single: shape(1), multi: shape(2)}).toStrictEqual({
			single: {
				card: CARD,
				item: ITEM,
				control: CONTROL,
				trailing: TRAILING,
				trailingParts: [
					["pointer-events-auto flex items-center gap-1", "Undo"],
					["flex items-center gap-2.5", "+1\u22121"],
				],
				chevrons: 0,
			},
			multi: {
				card: CARD,
				item: ITEM,
				control: CONTROL,
				trailing: TRAILING,
				trailingParts: [["flex items-center gap-2.5", "+1\u22121"]],
				chevrons: 0,
			},
		});
	});

	it('tooltips the single-file row "View this turn\'s changes" inside a pane host, as upstream', () => {
		vi.useFakeTimers();
		try {
			render(
				<SettingsProvider>
					<TileHost sessionId="turn-card-tooltip" onExpandWithoutPane={() => {}}>
						<TurnChangesCard sessionId="turn-card-tooltip" changes={changesWith(1)} undoable />
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

	it("uses upstream's U+2212 minus in the row stats and the closing See all totals", () => {
		const {container} = render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} undoable />);
		expect(container.querySelector("[data-turn-changes-card]")?.textContent).toBe(
			"Edited 2 filesUndofile-1.ts+1\u22121file-2.ts+2\u22121See all+3\u22122",
		);
	});

	it("draws upstream's summary card: 13/19 text on the card, 16px icons and 12/15 git stats", () => {
		const {container} = render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} undoable />);
		const card = container.querySelector<HTMLElement>("[data-turn-changes-card]")!;
		const [item] = screen.getAllByRole("listitem");

		expect({
			card: card.classList.contains("text-[13px]/[19px]"),
			title: screen.getByText("Edited 2 files").className,
			icon: item?.querySelector("svg")?.getAttribute("class"),
			name: within(item!).getByText("file-1.ts").className,
			stats: within(item!).getByText("+1").parentElement?.className,
			seeAll: within(card).getByText("See all").className,
		}).toStrictEqual({
			card: true,
			title: "min-w-0 truncate text-primary",
			icon: "lucide lucide-file-text size-4",
			name: "min-w-0 truncate text-primary",
			stats: "flex shrink-0 items-center gap-0.5 tabular-nums text-[12px]/[15px]",
			seeAll: "min-w-0 truncate text-primary",
		});
	});

	it("links each file row to the file viewer", () => {
		render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} undoable />);
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

	it("opens the Changes pane scoped to the turn from the See all row", () => {
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
						<TurnChangesCard sessionId="turn-card-session" changes={changesWith(2)} undoable />
					</TileHost>
				</SettingsProvider>,
			);
			const before = screen.queryByTestId("changes-pane");
			const card = screen.getByRole("list", {name: "Edited 2 files"}).parentElement!;
			act(() => {
				fireEvent.click(within(card).getByRole("button", {name: /^See all/}));
			});

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
						<TurnChangesCard sessionId="turn-card-single" changes={changesWith(1)} undoable />
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

	it("draws upstream's static multi-file header, a 1px divider, and See all as the list's last row", () => {
		render(
			<SettingsProvider>
				<TileHost sessionId="turn-card-header" onExpandWithoutPane={() => {}}>
					<TurnChangesCard sessionId="turn-card-header" changes={changesWith(2)} undoable />
				</TileHost>
			</SettingsProvider>,
		);
		const list = screen.getByRole("list", {name: "Edited 2 files"});
		const card = list.parentElement!;
		const [header, divider] = Array.from(card.children) as HTMLElement[];
		const items = within(list).getAllByRole("listitem");
		const seeAllItem = items.at(-1)!;

		expect({
			header: header!.className,
			headerTag: header!.tagName,
			headerButtons: within(header!)
				.getAllByRole("button")
				.map((button) => button.textContent),
			title: within(header!).getByText("Edited 2 files").className,
			divider: [divider!.className, divider!.getAttribute("aria-hidden"), divider!.childNodes.length],
			items: items.map((item) => item.textContent),
			seeAllLabel: within(seeAllItem).getByText("See all").className,
			seeAllButton: within(seeAllItem).getByRole("button").textContent,
			buttonsOutsideList: within(card)
				.getAllByRole("button")
				.filter((button) => !list.contains(button))
				.map((button) => button.textContent),
		}).toStrictEqual({
			header: "flex h-6 min-w-0 items-center justify-between gap-2 px-1",
			headerTag: "DIV",
			headerButtons: ["Undo"],
			title: "min-w-0 truncate text-primary",
			divider: ["-mx-[7px] h-px shrink-0 bg-alpha-2", "true", 0],
			items: ["file-1.ts+1\u22121", "file-2.ts+2\u22121", "See all+3\u22122"],
			seeAllLabel: "min-w-0 truncate text-primary",
			seeAllButton: "See all+3\u22122",
			buttonsOutsideList: ["Undo"],
		});
	});

	it("renders a static header outside a pane host", () => {
		render(<TurnChangesCard sessionId="test-session" changes={changesWith(2)} undoable />);
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
	const UNDO_LOOK = [
		"h-6",
		"px-2",
		"text-[12px]/[15px]",
		"text-muted-as-secondary",
		"hover:text-secondary",
		"hover:bg-fill-ghost-hover",
		"rounded-r5",
		"focus-visible:shadow-focus",
		"sr-only",
		"group-hover/card:not-sr-only",
		"-me-2",
	];
	const undoLook = (undo: HTMLElement) => UNDO_LOOK.filter((name) => undo.classList.contains(name));

	function undoTooltipOnFocus(files: number, send: ((text: string) => void) | null) {
		vi.useFakeTimers();
		try {
			render(
				<TurnUndoSendContext.Provider value={send}>
					<TurnChangesCard sessionId="s-look" changes={changesWith(files)} undoable />
				</TurnUndoSendContext.Provider>,
			);
			const undo = screen.getByRole("button", {name: "Undo"});
			const mouseDown = fireEvent.mouseDown(undo);
			fireEvent.focus(undo);
			act(() => {
				vi.advanceTimersByTime(400);
			});
			return {
				look: undoLook(undo),
				mouseDownPrevented: !mouseDown,
				tooltip: screen.queryByRole("tooltip")?.textContent,
			};
		} finally {
			vi.useRealTimers();
		}
	}

	it("draws a one-file card's Undo always visible in upstream's ghost look, tooltipped and not taking focus", () => {
		expect(undoTooltipOnFocus(1, () => {})).toStrictEqual({
			look: [
				"h-6",
				"px-2",
				"text-[12px]/[15px]",
				"text-muted-as-secondary",
				"hover:text-secondary",
				"hover:bg-fill-ghost-hover",
				"rounded-r5",
				"focus-visible:shadow-focus",
			],
			mouseDownPrevented: true,
			tooltip: "Ask Claude to undo this turn\u2019s file changes",
		});
	});

	it("pushes a multi-file card's Undo flush to the card edge", () => {
		expect(undoTooltipOnFocus(2, () => {})).toStrictEqual({
			look: [
				"h-6",
				"px-2",
				"text-[12px]/[15px]",
				"text-muted-as-secondary",
				"hover:text-secondary",
				"hover:bg-fill-ghost-hover",
				"rounded-r5",
				"focus-visible:shadow-focus",
				"-me-2",
			],
			mouseDownPrevented: true,
			tooltip: "Ask Claude to undo this turn\u2019s file changes",
		});
	});

	it("tooltips the no-live-pane fallback Undo with its own text", () => {
		expect(undoTooltipOnFocus(2, null).tooltip).toStrictEqual("Undo this turn's file changes");
	});

	it("Undo sends the undo prompt when the session has a live pane", () => {
		const calls = stubFetch([]);
		const send = vi.fn<(text: string) => void>();
		render(
			<TurnUndoSendContext.Provider value={send}>
				<TurnChangesCard sessionId="s-1" changes={changesWith(2)} undoable />
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
				<TurnChangesCard sessionId="s-1" changes={changesWith(1)} undoable />
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
		render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} undoable />);

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
		render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} undoable />);

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
		render(<TurnChangesCard sessionId="s-1" changes={changesWith(2)} undoable />);

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
