// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat, type SessionChatProps} from "../src/components/session-chat";
import {TranscriptActionsContext} from "../src/components/transcript-context-menu";
import {writeClipboardText} from "../src/lib/clipboard";
import {messageText} from "../src/lib/transcript-action-targets";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize()}));
vi.mock("../src/hooks/use-claude-events", () => ({useClaudeEvents: () => ({failedTools: new Map()})}));
vi.mock("../src/lib/clipboard", () => ({writeClipboardText: vi.fn(async () => true)}));
vi.mock("../src/lib/transcript-action-targets", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/lib/transcript-action-targets")>();
	return {...actual, messageText: vi.fn(actual.messageText)};
});

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
class FakeUtterance {
	onend: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(readonly text: string) {}
}
const forkFrom = vi.fn();
const pinChapter = vi.fn();
const speak = vi.fn();
const cancel = vi.fn();

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("innerHeight", 4000);
	vi.stubGlobal("requestAnimationFrame", () => 0);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("speechSynthesis", {speak, cancel});
	vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	vi.restoreAllMocks();
	document.documentElement.scrollTop = 0;
});

function text(uuid: string | undefined, value: string, sessionId = "example-main") {
	return {
		type: "assistant",
		uuid,
		sessionId,
		timestamp: "2000-01-01T00:00:00.000Z",
		message: {role: "assistant", content: [{type: "text", text: value}]},
	};
}
function command(uuid: string, sessionId = "example-main") {
	return [
		{
			type: "assistant",
			uuid,
			sessionId,
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: `example-tool-${uuid}`,
						name: "Bash",
						input: {command: "echo example", description: "Print example"},
					},
				],
			},
		},
		{
			type: "user",
			uuid: `example-result-${uuid}`,
			sessionId,
			message: {
				role: "user",
				content: [{type: "tool_result", tool_use_id: `example-tool-${uuid}`, content: "example"}],
			},
		},
	];
}
function notification(uuid: string) {
	return {
		type: "user",
		uuid,
		sessionId: "example-main",
		message: {
			role: "user",
			content: `<task-notification><task-id>example-task</task-id><status>completed</status><summary>Example notification</summary></task-notification>`,
		},
	};
}
function chat(records: unknown[], options: Partial<SessionChatProps> = {}) {
	const {lines, toolResultMap} = processTranscript(records);
	return (
		<TranscriptActionsContext.Provider value={{forkFrom, pinChapter}}>
			<SessionChat
				sessionId="example-main"
				lines={lines}
				toolResultMap={toolResultMap}
				showTranscriptOnly
				shouldScrollToEnd={false}
				{...options}
			/>
		</TranscriptActionsContext.Provider>
	);
}
function footers(container: HTMLElement) {
	return Array.from(container.querySelectorAll<HTMLElement>("[data-assistant-span-footer]"));
}
function button(footer: HTMLElement, label: string) {
	return footer.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
function focus(element: HTMLElement) {
	act(() => element.focus());
}
function anchor(footer: HTMLElement) {
	return footer.closest<HTMLElement>("[data-perf-line]")?.dataset["perfLine"];
}
function blur() {
	const outside = document.createElement("button");
	document.body.append(outside);
	focus(outside);
	outside.remove();
}

describe("assistant display-span actions", () => {
	it("keeps span actions and focus available while the grouped task summary loads", async () => {
		const view = render(
			chat([
				text("example-introduction", "Example task plan."),
				...["Alice", "Bob", "Charlie"].map((name) => ({
					type: "assistant",
					uuid: `example-${name}`,
					sessionId: "example-main",
					message: {
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: `example-task-${name}`,
								name: "TaskCreate",
								input: {subject: `Example ${name} task`},
							},
						],
					},
				})),
			]),
		);
		const loading = screen.getByText("Loading tasks…").getAttribute("role");
		const footer = footers(view.container)[0]!;
		const fork = button(footer, "Fork from here");
		focus(fork);
		await screen.findByRole("heading", {name: "Example Charlie task"});
		fireEvent.click(fork);
		fireEvent.click(button(footer, "Copy"));
		await act(async () => {});
		expect({
			loading,
			remainingLoading: screen.queryByText("Loading tasks…"),
			tasks: screen.getAllByRole("heading", {level: 3}).map((heading) => heading.textContent),
			sameFooter: footers(view.container)[0] === footer,
			focused: document.activeElement === fork,
			anchors: footers(view.container).map(anchor),
			fork: forkFrom.mock.calls,
			copy: vi.mocked(writeClipboardText).mock.calls,
		}).toStrictEqual({
			loading: "status",
			remainingLoading: null,
			tasks: ["Example Alice task", "Example Bob task", "Example Charlie task"],
			sameFooter: true,
			focused: true,
			anchors: ["1"],
			fork: [[{sessionId: "example-main", uuid: "example-Charlie"}]],
			copy: [["Example task plan."]],
		});
	});

	it("limits compact continuation spacing to collapsed successful tool disclosures", () => {
		const records = command("example-command");
		const conclusion = text("example-conclusion", "Example conclusion.");
		const view = render(chat([records[0], conclusion]));
		const spacingState = () => ({
			completedRows: view.container.querySelectorAll("[data-completed-tool-row]").length,
			footers: footers(view.container).length,
		});
		const pending = spacingState();
		view.rerender(chat([...records, conclusion]));
		const completed = spacingState();
		const disclosure = view.container.querySelector<HTMLElement>("[aria-expanded]")!;
		fireEvent.click(disclosure);
		const expanded = spacingState();
		fireEvent.click(disclosure);
		const collapsed = spacingState();
		view.rerender(
			chat([
				records[0],
				{
					...records[1],
					message: {
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "example-tool-example-command",
								content: "Example failure",
								is_error: true,
							},
						],
					},
				},
				conclusion,
			]),
		);
		expect({pending, completed, expanded, collapsed, failed: spacingState()}).toStrictEqual({
			pending: {completedRows: 0, footers: 1},
			completed: {completedRows: 1, footers: 1},
			expanded: {completedRows: 0, footers: 1},
			collapsed: {completedRows: 1, footers: 1},
			failed: {completedRows: 0, footers: 1},
		});
	});

	it("matches the 12px completed-tool continuation rule in globals.css against a rendered completed tool row", () => {
		const styles = readFileSync(join(process.cwd(), "src", "styles", "globals.css"), "utf8");
		const selector =
			/\/\* A completed standalone tool followed by prose[^*]*\*\/\s*([^{]+)\{\s*padding-bottom: 12px;/
				.exec(styles)?.[1]
				?.trim();
		const view = render(
			<div className="transcript-text">
				{chat([...command("example-command"), text("example-conclusion", "Example conclusion.")])}
			</div>,
		);
		const padded = () =>
			Array.from(view.container.querySelectorAll<HTMLElement>(selector!)).map(
				(element) => element.closest<HTMLElement>("[data-perf-line]")?.dataset["perfLine"],
			);
		const completed = padded();
		fireEvent.click(view.container.querySelector<HTMLElement>("[aria-expanded]")!);
		expect({completed, expanded: padded()}).toStrictEqual({completed: ["0"], expanded: []});
	});

	it("matches the 12px grouped-tool continuation rule in globals.css against status-led grouped rows that continue into prose, collapsed or expanded", () => {
		const styles = readFileSync(join(process.cwd(), "src", "styles", "globals.css"), "utf8");
		const selector = /\/\* A grouped tool summary followed by prose[^*]*\*\/\s*([^{]+)\{\s*padding-bottom: 12px;/
			.exec(styles)?.[1]
			?.trim();
		const view = render(
			<div className="transcript-text">
				{chat([
					...["Alice", "Bob", "Charlie"].map((name) => ({
						type: "assistant",
						uuid: `example-${name}`,
						sessionId: "example-main",
						message: {
							role: "assistant",
							content: [
								{
									type: "tool_use",
									id: `example-task-${name}`,
									name: "TaskCreate",
									input: {subject: `Example ${name} task`},
								},
							],
						},
					})),
					text("example-after-tasks", "Example after tasks."),
					...command("example-first"),
					...command("example-second"),
					text("example-middle", "Example middle."),
					...command("example-third"),
					...command("example-fourth"),
					text("example-other", "Example other source.", "example-other"),
					...command("example-fifth"),
					...command("example-sixth"),
				])}
			</div>,
		);
		const rowOf = (element: Element) => element.closest<HTMLElement>("[data-perf-line]")?.dataset["perfLine"];
		const padded = () => Array.from(view.container.querySelectorAll(selector ?? "[data-missing-rule]"), rowOf);
		const collapsed = padded();
		fireEvent.click(view.container.querySelector<HTMLElement>("button[aria-expanded]")!);
		expect({
			marked: Array.from(view.container.querySelectorAll("[data-grouped-tool-row]"), rowOf),
			collapsed,
			expanded: padded(),
		}).toStrictEqual({
			marked: ["4", "9", "14"],
			collapsed: ["4"],
			expanded: ["4"],
		});
	});

	it("copies authored text in order and targets the final assistant after tools and folded notifications", async () => {
		const view = render(
			chat([
				text("example-first", "Example introduction."),
				...command("example-command"),
				text("example-last", "Example conclusion."),
				notification("example-notice"),
			]),
		);
		const footer = footers(view.container)[0]!;
		fireEvent.click(button(footer, "Copy"));
		fireEvent.click(button(footer, "Fork from here"));
		fireEvent.click(button(footer, "Pin as chapter"));
		await act(async () => {});
		expect({
			anchors: footers(view.container).map(anchor),
			copy: vi.mocked(writeClipboardText).mock.calls,
			fork: forkFrom.mock.calls,
			pin: pinChapter.mock.calls,
			times: Array.from(footer.querySelectorAll("time"), (time) => time.dateTime),
		}).toStrictEqual({
			anchors: ["4"],
			copy: [["Example introduction.\n\nExample conclusion."]],
			fork: [[{sessionId: "example-main", uuid: "example-last"}]],
			pin: [[{sessionId: "example-main", uuid: "example-last"}]],
			times: ["2000-01-01T00:00:00.000Z"],
		});
	});

	it("freezes the focused DOM, text, endpoint, and timestamp until focus leaves", async () => {
		const initial = [text("example-first", "Example first.")];
		const view = render(chat(initial));
		const original = footers(view.container)[0]!;
		const copy = button(original, "Copy");
		focus(copy);
		view.rerender(
			chat([...initial, {...text("example-last", "Example last."), timestamp: "2000-01-02T00:00:00.000Z"}]),
		);
		fireEvent.click(copy);
		focus(button(original, "Fork from here"));
		fireEvent.click(button(original, "Fork from here"));
		const held = {
			sameNode: footers(view.container)[0] === original,
			focused: document.activeElement === button(original, "Fork from here"),
			anchors: footers(view.container).map(anchor),
			time: original.querySelector("time")?.dateTime,
		};
		blur();
		const moved = footers(view.container)[0]!;
		fireEvent.click(button(moved, "Copy"));
		fireEvent.click(button(moved, "Fork from here"));
		await act(async () => {});
		expect({
			held,
			after: {anchors: footers(view.container).map(anchor), time: moved.querySelector("time")?.dateTime},
			copy: vi.mocked(writeClipboardText).mock.calls,
			fork: forkFrom.mock.calls,
		}).toStrictEqual({
			held: {sameNode: true, focused: true, anchors: ["0"], time: "2000-01-01T00:00:00.000Z"},
			after: {anchors: ["1"], time: "2000-01-02T00:00:00.000Z"},
			copy: [["Example first."], ["Example first.\n\nExample last."]],
			fork: [
				[{sessionId: "example-main", uuid: "example-first"}],
				[{sessionId: "example-main", uuid: "example-last"}],
			],
		});
	});

	it.each(["single tool", "grouped tools", "notice", "grouped notice"])(
		"holds a focused %s entry through append and rejoins ordinary grouping on blur",
		(kind) => {
			const initial =
				kind === "single tool"
					? command("example-first")
					: kind === "grouped tools"
						? [...command("example-first"), ...command("example-second")]
						: kind === "notice"
							? [text("example-first", "Example first."), notification("example-notice")]
							: [...command("example-first"), notification("example-notice")];
			const view = render(chat(initial));
			const original = footers(view.container)[0]!;
			const originalArticle = original.closest('[role="article"]');
			const fork = button(original, "Fork from here");
			focus(fork);
			const beforeAnchor = anchor(original);
			view.rerender(chat([...initial, ...command("example-appended")]));
			fireEvent.click(fork);
			const held = {
				sameFooter: footers(view.container)[0] === original,
				sameArticle: footers(view.container)[0]?.closest('[role="article"]') === originalArticle,
				focused: document.activeElement === fork,
				anchors: footers(view.container).map(anchor),
				beforeAnchor,
				articles: view.container.querySelectorAll('[role="article"]').length,
			};
			blur();
			fireEvent.click(button(footers(view.container)[0]!, "Fork from here"));
			expect({
				held,
				after: {
					anchors: footers(view.container).map(anchor),
					articles: view.container.querySelectorAll('[role="article"]').length,
				},
				fork: forkFrom.mock.calls,
			}).toStrictEqual({
				held: {
					sameFooter: true,
					sameArticle: true,
					focused: true,
					anchors: [kind === "notice" ? "1" : "0"],
					beforeAnchor: kind === "notice" ? "1" : "0",
					articles: kind === "notice" ? 3 : 2,
				},
				after: {anchors: [kind === "notice" ? "1" : "0"], articles: kind === "notice" ? 2 : 1},
				fork: [
					[{sessionId: "example-main", uuid: kind === "grouped tools" ? "example-second" : "example-first"}],
					[{sessionId: "example-main", uuid: "example-appended"}],
				],
			});
		},
	);

	it("highlights a shared footer from another member without rerunning the text collector", () => {
		const view = render(chat([text("example-first", "Example first."), text("example-last", "Example last.")]));
		const article = view.container.querySelector('[role="article"]')!;
		const footer = footers(view.container)[0]!;
		vi.mocked(messageText).mockClear();
		fireEvent.pointerOver(article);
		const hovered = footer.querySelector("[data-message-actions]")?.hasAttribute("data-hovered");
		fireEvent.pointerOut(article, {relatedTarget: document.body});
		expect({
			calls: vi.mocked(messageText).mock.calls,
			hovered,
			after: footer.querySelector("[data-message-actions]")?.hasAttribute("data-hovered"),
		}).toStrictEqual({calls: [], hovered: true, after: false});
	});

	it("does not rebuild grouping when focus moves between buttons in the held toolbar", () => {
		const view = render(chat([text("example-first", "Example first.")]));
		const footer = footers(view.container)[0]!;
		focus(button(footer, "Copy"));
		vi.mocked(messageText).mockClear();
		focus(button(footer, "Fork from here"));
		focus(button(footer, "Pin as chapter"));
		expect({
			calls: vi.mocked(messageText).mock.calls,
			sameFooter: footers(view.container)[0] === footer,
			focused: document.activeElement?.getAttribute("aria-label"),
		}).toStrictEqual({calls: [], sameFooter: true, focused: "Pin as chapter"});
	});

	it("keeps source A/B/A separate even across grouped tools", async () => {
		const view = render(
			chat([
				text("example-a", "Example A."),
				...command("example-b", "example-agent"),
				text("example-c", "Example C."),
			]),
		);
		for (const footer of footers(view.container)) {
			fireEvent.click(button(footer, "Copy"));
			fireEvent.click(button(footer, "Pin as chapter"));
			fireEvent.click(button(footer, "Fork from here"));
		}
		await act(async () => {});
		expect({
			copy: vi.mocked(writeClipboardText).mock.calls,
			pin: pinChapter.mock.calls,
			fork: forkFrom.mock.calls,
		}).toStrictEqual({
			copy: [["Example A."], [""], ["Example C."]],
			pin: [
				[{sessionId: "example-main", uuid: "example-a"}],
				[{sessionId: "example-agent", uuid: "example-b"}],
				[{sessionId: "example-main", uuid: "example-c"}],
			],
			fork: [
				[{sessionId: "example-main", uuid: "example-a"}],
				[{sessionId: "example-agent", uuid: "example-b"}],
				[{sessionId: "example-main", uuid: "example-c"}],
			],
		});
	});

	it("uses the last visible assistant endpoint and disables missing UUID actions without an earlier fallback", () => {
		const records = [text("example-first", "Example first."), ...command("example-last")];
		const view = render(chat(records));
		fireEvent.click(button(footers(view.container)[0]!, "Fork from here"));
		view.rerender(chat(records, {showTools: false}));
		fireEvent.click(button(footers(view.container)[0]!, "Fork from here"));
		view.rerender(chat([...records, text(undefined, "Example missing UUID.")]));
		const footer = footers(view.container)[0]!;
		expect({
			fork: forkFrom.mock.calls,
			disabled: ["Copy", "Fork from here", "Pin as chapter", "Read aloud"].map((name) => [
				name,
				button(footer, name).disabled,
			]),
		}).toStrictEqual({
			fork: [
				[{sessionId: "example-main", uuid: "example-last"}],
				[{sessionId: "example-main", uuid: "example-first"}],
			],
			disabled: [
				["Copy", false],
				["Fork from here", true],
				["Pin as chapter", true],
				["Read aloud", false],
			],
		});
	});

	it.each(["normal", "thinking", "verbose"] as const)(
		"recognizes plain notifications before prompt classification in %s mode",
		(transcriptMode) => {
			const records = [
				text("example-first", "Example first."),
				notification("example-notice"),
				text("example-last", "Example last."),
				{type: "user", uuid: "example-prompt", message: {role: "user", content: "Example next prompt."}},
				text("example-next", "Example next answer."),
			];
			const view = render(chat(records, {transcriptMode}));
			expect({
				footers: footers(view.container).map(anchor),
				actionCount: view.container.querySelectorAll("[data-message-actions]").length,
			}).toStrictEqual(
				transcriptMode === "verbose" ? {footers: [], actionCount: 5} : {footers: ["2", "4"], actionCount: 3},
			);
		},
	);

	it("reads the chosen record after its menu closes and cancels only when its owner unmounts", () => {
		const view = render(chat([text("example-first", "Example **first**."), text("example-last", "Example last.")]));
		const prose = view.container.querySelector("strong")!;
		fireEvent.contextMenu(prose, {clientX: 10, clientY: 10});
		fireEvent.click(screen.getByRole("menuitem", {name: /^Read aloud$/}));
		const afterClose = {
			texts: speak.mock.calls.map(([utterance]) => utterance.text),
			cancels: cancel.mock.calls.map((args) => [...args]),
			menus: screen.queryAllByRole("menu").length,
		};
		view.unmount();
		expect({afterClose, afterUnmount: cancel.mock.calls}).toStrictEqual({
			afterClose: {texts: ["Example first."], cancels: [[]], menus: 0},
			afterUnmount: [[], []],
		});
	});
	it("keeps repeated authored text and excludes thinking, tools, and reminders from speech", () => {
		const records = [
			text("example-first", "Example repeated."),
			{
				type: "attachment",
				uuid: "example-reminder",
				attachment: {type: "total_tokens_reminder", text: "Example hidden reminder"},
			},
			{
				type: "assistant",
				uuid: "example-thinking",
				message: {role: "assistant", content: [{type: "thinking", thinking: "Example private reasoning"}]},
			},
			...command("example-command"),
			text("example-last", "Example repeated."),
		];
		const view = render(chat(records, {showThinking: true, transcriptMode: "thinking"}));
		fireEvent.click(button(footers(view.container)[0]!, "Read aloud"));
		expect({
			footers: footers(view.container).map(anchor),
			speech: speak.mock.calls.map(([utterance]) => utterance.text),
		}).toStrictEqual({footers: ["5"], speech: ["Example repeated.\n\nExample repeated."]});
	});

	it("renders no footer-only rows for hidden assistant content", () => {
		const view = render(
			chat(
				[
					{
						type: "assistant",
						uuid: "example-thinking",
						message: {role: "assistant", content: [{type: "thinking", thinking: "Example reasoning"}]},
					},
					command("example-tool")[0],
				],
				{showTools: false, showThinking: false},
			),
		);
		expect({
			footers: footers(view.container).map(anchor),
			rows: Array.from(view.container.querySelectorAll('[role="article"]'), (row) => row.textContent),
		}).toStrictEqual({footers: [], rows: []});
	});

	it("releases an unmounted held entry without hiding a newly focused span and keeps virtual rows bounded", () => {
		vi.stubGlobal("innerHeight", 1000);
		const frames = new Map<number, FrameRequestCallback>();
		let frameId = 0;
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.set(++frameId, callback);
			return frameId;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			return new DOMRect(
				0,
				this.dataset["testid"] === "virtualized-transcript" ? -document.documentElement.scrollTop : 0,
				768,
				320,
			);
		});
		const records = Array.from({length: 50}, (_, index) => [
			{
				type: "user",
				uuid: `example-prompt-${index}`,
				message: {role: "user", content: `Example prompt ${index}`},
			},
			text(`example-answer-${index}`, `Example answer ${index}.`),
		]).flat();
		const view = render(chat(records));
		const original = footers(view.container)[0]!;
		focus(button(original, "Fork from here"));
		act(() => {
			window.dispatchEvent(new CustomEvent("transcript-jump-request", {detail: 98}));
		});
		const target = view.container.querySelector<HTMLElement>('[data-record-index="98"]')!;
		const scrollIntoView = vi.fn();
		target.scrollIntoView = scrollIntoView;
		act(() => {
			for (const id of [...frames.keys()]) {
				const callback = frames.get(id);
				frames.delete(id);
				callback?.(0);
			}
		});
		const latest = footers(view.container).at(-1)!;
		const fork = button(latest, "Fork from here");
		focus(fork);
		view.rerender(chat([...records, text("example-appended", "Example appended.")]));
		fireEvent.click(fork);
		expect({
			originalConnected: original.isConnected,
			completedJump: scrollIntoView.mock.calls,
			focused: document.activeElement === fork,
			rows: Array.from(
				view.container.querySelectorAll<HTMLElement>('[role="article"]'),
				(row) => row.dataset["perfLine"],
			),
			footers: footers(view.container).map(anchor),
			fork: forkFrom.mock.calls,
		}).toStrictEqual({
			originalConnected: false,
			completedJump: [[{block: "center", behavior: "smooth"}]],
			focused: true,
			rows: ["95", "96", "97", "98", "99", "100"],
			footers: ["95", "97", "99"],
			fork: [[{sessionId: "example-main", uuid: "example-answer-49"}]],
		});
	});

	it("preserves the answered-question group boundary while sharing one footer", () => {
		const question = {
			type: "assistant",
			uuid: "example-question",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "example-question-tool",
						name: "AskUserQuestion",
						input: {
							questions: [
								{
									question: "Continue the example?",
									header: "Example",
									multiSelect: false,
									options: [
										{label: "Continue", description: "Run the example"},
										{label: "Stop", description: "Stop the example"},
									],
								},
							],
						},
					},
				],
			},
		};
		const answer = {
			type: "user",
			uuid: "example-answer",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "example-question-tool",
						content:
							'Your questions have been answered: "Continue the example?"="Continue". You can now continue with these answers in mind.',
					},
				],
			},
		};
		const view = render(
			chat([
				...command("example-before"),
				question,
				answer,
				...command("example-after-one"),
				...command("example-after-two"),
				text("example-end", "Example conclusion."),
			]),
		);
		fireEvent.click(button(footers(view.container)[0]!, "Fork from here"));
		expect({
			content: Array.from(
				view.container.querySelectorAll('[data-tool-row] > [role="button"], [data-tool-row] > button, p'),
				(element) => element.textContent,
			),
			anchors: footers(view.container).map(anchor),
			fork: forkFrom.mock.calls,
		}).toStrictEqual({
			content: ["Printed example", "Continue the example?", "Continue", "Ran 2 commands", "Example conclusion."],
			anchors: ["8"],
			fork: [[{sessionId: "example-main", uuid: "example-end"}]],
		});
	});

	it("places the span footer after its changes card and trailing notice", () => {
		const edit = {
			type: "assistant",
			uuid: "example-edit",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "example-edit-tool",
						name: "Edit",
						input: {
							file_path: "/tmp/example/cache.ts",
							old_string: "example old",
							new_string: "example new",
						},
					},
				],
			},
		};
		const result = {
			type: "user",
			uuid: "example-edit-result",
			message: {
				role: "user",
				content: [{type: "tool_result", tool_use_id: "example-edit-tool", content: "example done"}],
			},
		};
		const view = render(
			chat([edit, result, text("example-end", "Example conclusion."), notification("example-notice")]),
		);
		const footer = footers(view.container)[0]!;
		const changes = view.container.querySelector("[data-turn-changes-card]");
		expect({
			anchors: footers(view.container).map(anchor),
			changesBefore: changes?.compareDocumentPosition(footer),
			recordOrder: Array.from(view.container.querySelectorAll("[data-record-index]"), (element) =>
				element.getAttribute("data-record-index"),
			),
		}).toStrictEqual({
			anchors: ["3"],
			changesBefore: Node.DOCUMENT_POSITION_FOLLOWING,
			recordOrder: ["0", "2", "3"],
		});
	});
	it("keeps focused group actions mounted when an appended failed edit removes the changes card", () => {
		const edit = {
			type: "assistant",
			uuid: "example-edit",
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "example-edit-tool",
						name: "Edit",
						input: {
							file_path: "/tmp/example/cache.ts",
							old_string: "example old",
							new_string: "example new",
						},
					},
				],
			},
		};
		const failure = {
			type: "user",
			uuid: "example-error-result",
			message: {
				role: "user",
				content: [
					{type: "tool_result", tool_use_id: "example-edit-tool", content: "example failure", is_error: true},
				],
			},
		};
		const records = [...command("example-command"), edit];
		const view = render(chat(records));
		const original = footers(view.container)[0]!;
		const fork = button(original, "Fork from here");
		focus(fork);
		const cardBefore = view.container.querySelectorAll("[data-turn-changes-card]").length;
		view.rerender(chat([...records, failure]));
		fireEvent.click(fork);
		expect({
			cardBefore,
			cardAfter: view.container.querySelectorAll("[data-turn-changes-card]").length,
			articles: Array.from(
				view.container.querySelectorAll<HTMLElement>('[role="article"]'),
				(article) => article.dataset["perfLine"],
			),
			sameFooter: footers(view.container)[0] === original,
			focused: document.activeElement === fork,
			fork: forkFrom.mock.calls,
		}).toStrictEqual({
			cardBefore: 1,
			cardAfter: 0,
			articles: ["0"],
			sameFooter: true,
			focused: true,
			fork: [[{sessionId: "example-main", uuid: "example-edit"}]],
		});
	});

	it.each(["ContextMenu", "F10"])(
		"opens the earlier record menu from article keyboard navigation using %s",
		async (key) => {
			const view = render(chat([text("example-first", "Example first."), text("example-last", "Example last.")]));
			const article = view.container.querySelector<HTMLElement>('[role="article"]')!;
			focus(article);
			fireEvent.keyDown(article, {key, shiftKey: key === "F10"});
			fireEvent.click(screen.getByRole("menuitem", {name: "Copy message as Markdown"}));
			focus(article);
			fireEvent.keyDown(article, {key, shiftKey: key === "F10"});
			fireEvent.click(screen.getByRole("menuitem", {name: "Pin as chapter"}));
			await act(async () => {});
			expect({
				anchors: footers(view.container).map(anchor),
				copy: vi.mocked(writeClipboardText).mock.calls,
				pin: pinChapter.mock.calls,
			}).toStrictEqual({
				anchors: ["1"],
				copy: [["Example first."]],
				pin: [[{sessionId: "example-main", uuid: "example-first"}]],
			});
		},
	);
	it("focuses a keyboard-opened record menu and returns to its article on Escape", async () => {
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
		vi.stubGlobal("cancelAnimationFrame", clearTimeout);
		const view = render(
			chat([
				text("example-first", "Example [first](https://example.com/first)."),
				text("example-last", "Example last."),
			]),
		);
		const article = view.container.querySelector<HTMLElement>('[role="article"]')!;
		const link = screen.getByRole("link", {name: "first"});
		// Give this real descendant link a visible box so Base UI's tabbable lookup runs as in a browser.
		const rect = new DOMRect(0, 0, 100, 20);
		vi.spyOn(link, "getClientRects").mockReturnValue(Object.assign([rect], {item: () => rect}));
		focus(article);
		fireEvent.keyDown(article, {key: "F10", shiftKey: true});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		const menu = screen.getByRole("menu");
		const opened = {
			focusInMenu: menu.contains(document.activeElement),
			focusedRole: document.activeElement?.getAttribute("role"),
		};
		fireEvent.keyDown(menu, {key: "Escape"});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		const escaped = {
			closedMenus: screen.queryAllByRole("menu").length,
			restoredArticle: document.activeElement === article,
		};
		fireEvent.keyDown(article, {key: "ContextMenu"});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		fireEvent.keyDown(screen.getByRole("menu"), {key: "ArrowDown"});
		const selected = document.activeElement!;
		const selectedText = selected.textContent;
		fireEvent.keyDown(selected, {key: "Enter"});
		fireEvent.keyUp(selected, {key: "Enter"});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect({
			opened,
			escaped,
			selectedText,
			copy: vi.mocked(writeClipboardText).mock.calls,
			closedMenus: screen.queryAllByRole("menu").length,
			restoredArticle: document.activeElement === article,
		}).toStrictEqual({
			opened: {focusInMenu: true, focusedRole: "menu"},
			escaped: {closedMenus: 0, restoredArticle: true},
			selectedText: "Copy message",
			copy: [["Example first."]],
			closedMenus: 0,
			restoredArticle: true,
		});
	});
	it.each(["pointer origin", "outside pointer", "deferred action focus", "another menu focus"])(
		"preserves %s when closing a linked record menu",
		async (scenario) => {
			vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0));
			vi.stubGlobal("cancelAnimationFrame", clearTimeout);
			const view = render(
				<>
					<button>Example outside</button>
					{chat([
						text("example-first", "Example [first](https://example.com/first)."),
						text("example-last", "Example last."),
					])}
				</>,
			);
			const article = view.container.querySelector<HTMLElement>('[role="article"]')!;
			const link = screen.getByRole("link", {name: "first"});
			const rect = new DOMRect(0, 0, 100, 20);
			vi.spyOn(link, "getClientRects").mockReturnValue(Object.assign([rect], {item: () => rect}));
			const outside = screen.getByRole("button", {name: "Example outside"});
			focus(article);
			if (scenario === "pointer origin") {
				fireEvent.contextMenu(article.querySelector("[data-transcript-message-menu]")!, {button: 2});
			} else {
				fireEvent.keyDown(article, {key: "F10", shiftKey: true});
			}
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			const menu = screen.getByRole("menu");
			const openedWithMenuFocus = menu.contains(document.activeElement);
			if (scenario === "pointer origin") {
				fireEvent.keyDown(menu, {key: "Escape"});
			} else if (scenario === "outside pointer") {
				fireEvent.pointerDown(outside, {button: 0, pointerType: "mouse"});
				focus(outside);
			} else {
				pinChapter.mockImplementationOnce(() => {
					if (scenario === "another menu focus") outside.setAttribute("role", "menu");
					queueMicrotask(() => outside.focus());
				});
				fireEvent.click(screen.getByRole("menuitem", {name: "Pin as chapter"}));
			}
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			expect({
				openedWithMenuFocus,
				closedMenus: screen.queryAllByRole("menu").length,
				focused: document.activeElement,
				articleTabIndex: article.tabIndex,
			}).toStrictEqual({
				openedWithMenuFocus: true,
				closedMenus: scenario === "another menu focus" ? 1 : 0,
				focused: scenario === "pointer origin" ? link : outside,
				articleTabIndex: -1,
			});
		},
	);
});
