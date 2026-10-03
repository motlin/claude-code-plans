// @vitest-environment jsdom

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
		const latest = footers(view.container).at(-1)!;
		const fork = button(latest, "Fork from here");
		focus(fork);
		view.rerender(chat([...records, text("example-appended", "Example appended.")]));
		fireEvent.click(fork);
		expect({
			originalConnected: original.isConnected,
			focused: document.activeElement === fork,
			rows: Array.from(
				view.container.querySelectorAll<HTMLElement>('[role="article"]'),
				(row) => row.dataset["perfLine"],
			),
			footers: footers(view.container).map(anchor),
			fork: forkFrom.mock.calls,
		}).toStrictEqual({
			originalConnected: false,
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
		const view = render(chat([text("example-first", "Example first."), text("example-last", "Example last.")]));
		const article = view.container.querySelector<HTMLElement>('[role="article"]')!;
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
});
