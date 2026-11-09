// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {composerDraftStorageKey} from "../src/hooks/use-composer-draft";
import {requestComposerInsert, requestComposerTakeBack} from "../src/lib/context-attach";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import {HerdrRequestError} from "../src/lib/api/herdr";
import {
	hasHiddenCharacters,
	isShellCommandText,
	runShellCommandInPane,
	shellCommandUnavailableMessage,
} from "../src/lib/composer-shell-command";

/** A stand-in for Shiki: the first word of each line is a command, the rest arguments. */
const highlightCalls = vi.hoisted(() => [] as boolean[]);

vi.mock("../src/hooks/use-bash-highlight", () => ({
	useBashHighlight: (code: string, enabled: boolean) => {
		highlightCalls.push(enabled);
		if (!enabled) return null;
		return code.split("\n").map((line) => {
			const [command = "", ...args] = line.split(" ");
			const rest = args.length === 0 ? [] : [{content: ` ${args.join(" ")}`, color: "#00aa00", offset: 0}];
			return [{content: command, color: "#aa0000", fontStyle: 2, offset: 0}, ...rest];
		});
	},
}));

afterEach(() => {
	highlightCalls.length = 0;
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
});

function stubPointer(coarse: boolean) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches: coarse && query === "(pointer: coarse)",
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
}

async function flush() {
	await act(async () => {
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	});
}

interface RenderOptions {
	variant?: "session" | "home";
	onShellCommand?: ((command: string) => Promise<boolean>) | undefined;
	working?: boolean;
	coarse?: boolean;
	subscribePrefill?: ((listener: (text: string) => void) => () => void) | undefined;
	promptHistory?: readonly string[];
	bashHistory?: readonly string[];
}

function renderComposer({
	variant = "session",
	onShellCommand,
	working = false,
	coarse = false,
	subscribePrefill,
	promptHistory,
	bashHistory,
}: RenderOptions = {}) {
	stubPointer(coarse);
	const handlers = {
		onSend: vi.fn<(prompt: string) => void>(),
		onStop: vi.fn<() => void>(),
		onQueueForLater: vi.fn<(prompt: string) => void>(),
		toast: vi.fn<(options: ToastOptions) => void>(),
	};
	render(
		<ToastContext.Provider value={handlers.toast}>
			<Composer
				variant={variant}
				draftKey={variant === "home" ? "home" : "session-alice"}
				onSend={(prompt) => {
					handlers.onSend(prompt);
				}}
				onStop={working ? handlers.onStop : undefined}
				onQueueForLater={working ? handlers.onQueueForLater : undefined}
				onShellCommand={onShellCommand}
				subscribePrefill={subscribePrefill}
				promptHistory={promptHistory}
				bashHistory={bashHistory}
			/>
		</ToastContext.Provider>,
	);
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	return {handlers, textarea};
}

function card(): HTMLElement {
	const element = document.querySelector<HTMLElement>("[data-composer-card]");
	if (element === null) throw new Error("no composer card");
	return element;
}

function composerRoot(): HTMLElement {
	const element = document.querySelector<HTMLElement>('[data-cds="ChatComposer"]');
	if (element === null) throw new Error("no composer root");
	return element;
}

/** Upstream's `<span role="status" class="sr-only">` bash/chat announcements. */
function statusTexts(): string[] {
	return [...document.querySelectorAll('span[role="status"].sr-only')].map((node) => node.textContent);
}

function bashState(textarea: HTMLTextAreaElement) {
	return {
		bashMode: composerRoot().getAttribute("data-bash-mode") === "true",
		pill: document.querySelector("[data-bash-pill]")?.textContent ?? null,
		placeholder: screen.queryByTestId("composer-placeholder")?.textContent ?? null,
		description: textarea.getAttribute("aria-description"),
		status: statusTexts(),
		value: textarea.value,
	};
}

const CHAT_PLACEHOLDER = "Type / for commands";
const BASH_PLACEHOLDER = "Run a shell command in the terminal and send the output to Claude";

const BASH_STATE = {
	bashMode: true,
	pill: "bash",
	placeholder: BASH_PLACEHOLDER,
	description: BASH_PLACEHOLDER,
	status: ["Bash mode. Press Escape to return to chat."],
	value: "",
};

const CHAT_STATE = {
	bashMode: false,
	pill: null,
	placeholder: CHAT_PLACEHOLDER,
	description: null,
	status: ["Chat mode"],
	value: "",
};

function pressBang(textarea: HTMLTextAreaElement): boolean {
	return fireEvent.keyDown(textarea, {key: "!"});
}

describe("Composer bash mode with a live pane", () => {
	it("enters bash mode when ! is typed into the empty composer, without inserting it", () => {
		const {textarea} = renderComposer({
			onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
		});
		const placeholderBefore = bashState(textarea).placeholder;
		const notCancelled = pressBang(textarea);

		expect({placeholderBefore, notCancelled, state: bashState(textarea)}).toStrictEqual({
			placeholderBefore: CHAT_PLACEHOLDER,
			notCancelled: false,
			state: BASH_STATE,
		});
	});

	it("types ! normally when the composer already has text", () => {
		const {textarea} = renderComposer({
			onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
		});
		fireEvent.change(textarea, {target: {value: "Alice"}});
		const notCancelled = pressBang(textarea);

		expect({notCancelled, bashMode: bashState(textarea).bashMode}).toStrictEqual({
			notCancelled: true,
			bashMode: false,
		});
	});

	it("exits bash mode on Backspace in the empty composer", () => {
		const {textarea} = renderComposer({
			onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
		});
		pressBang(textarea);
		const notCancelled = fireEvent.keyDown(textarea, {key: "Backspace"});

		expect({notCancelled, state: bashState(textarea)}).toStrictEqual({
			notCancelled: false,
			state: CHAT_STATE,
		});
	});

	it("keeps bash mode on Backspace while the command has text", () => {
		const {textarea} = renderComposer({
			onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
		});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "ls"}});
		const notCancelled = fireEvent.keyDown(textarea, {key: "Backspace"});

		expect({notCancelled, bashMode: bashState(textarea).bashMode}).toStrictEqual({
			notCancelled: true,
			bashMode: true,
		});
	});

	it("exits bash mode on Escape and keeps the typed text", () => {
		const {textarea} = renderComposer({
			onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
		});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "ls"}});
		fireEvent.keyDown(textarea, {key: "Escape"});

		expect({bashMode: bashState(textarea).bashMode, value: textarea.value}).toStrictEqual({
			bashMode: false,
			value: "ls",
		});
	});

	it("leaves Escape to Stop while Claude works", () => {
		const {textarea} = renderComposer({
			onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
			working: true,
		});
		pressBang(textarea);
		const notCancelled = fireEvent.keyDown(textarea, {key: "Escape"});

		expect({notCancelled, bashMode: bashState(textarea).bashMode}).toStrictEqual({
			notCancelled: true,
			bashMode: true,
		});
	});

	it("runs the command through onShellCommand on Enter, then clears and returns to chat", async () => {
		const onShellCommand = vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true);
		const {handlers, textarea} = renderComposer({onShellCommand});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "  ls -la  "}});
		fireEvent.keyDown(textarea, {key: "Enter"});
		await flush();

		expect({
			commands: onShellCommand.mock.calls,
			sent: handlers.onSend.mock.calls,
			state: bashState(textarea),
		}).toStrictEqual({
			commands: [["ls -la"]],
			sent: [],
			state: CHAT_STATE,
		});
	});

	it("does nothing on Enter with an empty command", async () => {
		const onShellCommand = vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true);
		const {textarea} = renderComposer({onShellCommand});
		pressBang(textarea);
		fireEvent.keyDown(textarea, {key: "Enter"});
		await flush();

		expect({commands: onShellCommand.mock.calls, bashMode: bashState(textarea).bashMode}).toStrictEqual({
			commands: [],
			bashMode: true,
		});
	});

	it("puts a refused command back in bash mode", async () => {
		const onShellCommand = vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(false);
		const {textarea} = renderComposer({onShellCommand});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "ls"}});
		fireEvent.keyDown(textarea, {key: "Enter"});
		await flush();

		expect({bashMode: bashState(textarea).bashMode, value: textarea.value}).toStrictEqual({
			bashMode: true,
			value: "ls",
		});
	});

	it("never queues or steers a command while Claude works", async () => {
		const onShellCommand = vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true);
		const {handlers, textarea} = renderComposer({onShellCommand, working: true});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "git status"}});
		fireEvent.keyDown(textarea, {key: "Enter", metaKey: true});
		await flush();
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "pwd"}});
		fireEvent.keyDown(textarea, {key: "Enter"});
		await flush();

		expect({
			commands: onShellCommand.mock.calls,
			sent: handlers.onSend.mock.calls,
			queued: handlers.onQueueForLater.mock.calls,
		}).toStrictEqual({commands: [["git status"], ["pwd"]], sent: [], queued: []});
	});

	it("reduces the touch Send menu to Stop in bash mode", async () => {
		const {textarea} = renderComposer({
			onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
			working: true,
			coarse: true,
		});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "ls"}});
		fireEvent.click(screen.getByRole("button", {name: "More send options"}));
		await flush();
		const entries = [...screen.getByRole("menu").querySelectorAll('[role="menuitem"], [role="separator"]')]
			.filter((node) => node.closest("[data-cds-sheet-control]") === null)
			.map((node) => (node.getAttribute("role") === "separator" ? "---" : node.textContent));

		expect(entries).toStrictEqual(["Stop"]);
	});

	it("rings the card in the pro colour while in bash mode", () => {
		const {textarea} = renderComposer({
			onShellCommand: vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true),
		});
		const before = card().className.includes("inset-ring-1");
		pressBang(textarea);

		expect({before, after: card().className.includes("inset-ring-1")}).toStrictEqual({before: false, after: true});
	});
});

function paintedTokens() {
	const overlay = document.querySelector<HTMLElement>("[data-bash-highlight]");
	if (overlay === null) return null;
	return {
		text: overlay.textContent,
		tokens: [...overlay.querySelectorAll<HTMLElement>("[data-bash-token]")].map((span) => ({
			content: span.textContent,
			style: span.getAttribute("style"),
		})),
	};
}

const ALLOW = vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true);

describe("Composer bash mode highlighting", () => {
	it("paints the typed command as bash over a transparent editor", () => {
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "git status\nls"}});

		expect({painted: paintedTokens(), transparent: textarea.className.includes("text-transparent")}).toStrictEqual({
			painted: {
				text: "git status\nls",
				tokens: [
					{content: "git", style: "color: rgb(170, 0, 0); font-weight: bold;"},
					{content: " status", style: "color: rgb(0, 170, 0);"},
					{content: "ls", style: "color: rgb(170, 0, 0); font-weight: bold;"},
				],
			},
			transparent: true,
		});
	});

	it("leaves chat text unhighlighted and never asks for the bash grammar", () => {
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		fireEvent.change(textarea, {target: {value: "git status"}});

		expect({
			painted: paintedTokens(),
			transparent: textarea.className.includes("text-transparent"),
			enabled: [...new Set(highlightCalls)],
		}).toStrictEqual({painted: null, transparent: false, enabled: [false]});
	});
});

describe("Composer bash mode drafts", () => {
	it("saves bash mode with the draft and restores it", async () => {
		const first = renderComposer({onShellCommand: ALLOW});
		pressBang(first.textarea);
		fireEvent.change(first.textarea, {target: {value: "ls -la"}});
		cleanup();
		const stored: unknown = JSON.parse(localStorage.getItem(composerDraftStorageKey("session-alice")) ?? "null");
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		await flush();

		expect({stored, state: bashState(textarea)}).toStrictEqual({
			stored: {text: "ls -la", bashMode: true},
			state: {...BASH_STATE, placeholder: null, value: "ls -la"},
		});
	});

	it("drops bash mode from the draft on leaving it", () => {
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "ls"}});
		fireEvent.keyDown(textarea, {key: "Escape"});
		cleanup();

		expect(JSON.parse(localStorage.getItem(composerDraftStorageKey("session-alice")) ?? "null")).toStrictEqual({
			text: "ls",
		});
	});

	it("restores a bash-mode draft as chat where no live pane can run it", async () => {
		localStorage.setItem(composerDraftStorageKey("session-alice"), JSON.stringify({text: "ls", bashMode: true}));
		const {textarea} = renderComposer();
		await flush();

		expect({bashMode: bashState(textarea).bashMode, value: textarea.value}).toStrictEqual({
			bashMode: false,
			value: "ls",
		});
	});
});

const COMMAND_IN_BOX = "A command is in the message box, so nothing was added. Send or clear it first, then try again.";
const BASH_MODE_ON =
	"Bash mode is on, so nothing was added. Press Backspace in the empty message box to return to chat, then try again.";
const HAS_DRAFT = "The input already has a draft. Clear it to pull this message back in.";

describe("Composer bash mode refuses added text", () => {
	it("refuses a take-back, so the caller keeps the cancelled message", () => {
		const {handlers, textarea} = renderComposer({onShellCommand: ALLOW});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "ls"}});
		let taken = true;
		act(() => {
			taken = requestComposerTakeBack("session-alice", "Fix the tests");
		});

		expect({taken, value: textarea.value, toasts: handlers.toast.mock.calls}).toStrictEqual({
			taken: false,
			value: "ls",
			toasts: [[{kind: "error", message: HAS_DRAFT}]],
		});
	});

	it("refuses inserted text such as a Fix-this prompt", () => {
		const {handlers, textarea} = renderComposer({onShellCommand: ALLOW});
		pressBang(textarea);
		act(() => {
			requestComposerInsert("session-alice", "Fix this finding");
		});

		expect({state: bashState(textarea), toasts: handlers.toast.mock.calls}).toStrictEqual({
			state: BASH_STATE,
			toasts: [[{kind: "error", message: BASH_MODE_ON}]],
		});
	});

	it("refuses a prefill", () => {
		const listeners: Array<(text: string) => void> = [];
		const {handlers, textarea} = renderComposer({
			onShellCommand: ALLOW,
			subscribePrefill: (listener) => {
				listeners.push(listener);
				return () => undefined;
			},
		});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "pwd"}});
		act(() => {
			for (const listener of listeners) listener("Summarize the repo");
		});

		expect({value: textarea.value, toasts: handlers.toast.mock.calls}).toStrictEqual({
			value: "pwd",
			toasts: [[{kind: "error", message: BASH_MODE_ON}]],
		});
	});

	it("refuses an insert or prefill while chat text reads as a `! command`", () => {
		const listeners: Array<(text: string) => void> = [];
		const {handlers, textarea} = renderComposer({
			onShellCommand: ALLOW,
			subscribePrefill: (listener) => {
				listeners.push(listener);
				return () => undefined;
			},
		});
		fireEvent.change(textarea, {target: {value: "! ls"}});
		act(() => {
			requestComposerInsert("session-alice", "Fix this finding");
		});
		act(() => {
			for (const listener of listeners) listener("Summarize the repo");
		});

		expect({value: textarea.value, toasts: handlers.toast.mock.calls}).toStrictEqual({
			value: "! ls",
			toasts: [[{kind: "error", message: COMMAND_IN_BOX}], [{kind: "error", message: COMMAND_IN_BOX}]],
		});
	});

	it("still takes a cancelled message back over `! command` chat text", () => {
		const {handlers, textarea} = renderComposer({onShellCommand: ALLOW});
		fireEvent.change(textarea, {target: {value: "! ls"}});
		let taken = false;
		act(() => {
			taken = requestComposerTakeBack("session-alice", "Fix the tests");
		});

		expect({taken, toasts: handlers.toast.mock.calls}).toStrictEqual({taken: true, toasts: []});
	});

	it("still takes a cancelled message back in chat mode", () => {
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		let taken = false;
		act(() => {
			taken = requestComposerTakeBack("session-alice", "Fix the tests");
		});

		expect({taken, value: textarea.value}).toStrictEqual({taken: true, value: "Fix the tests"});
	});
});

function fontClasses(element: Element | null): string[] {
	return (element?.className.split(/\s+/) ?? []).filter((name) => name === "font-sans" || name === "font-mono");
}

function editorFonts(textarea: HTMLTextAreaElement) {
	return {
		root: composerRoot().getAttribute("data-bash-mode"),
		card: card().hasAttribute("data-bash-mode"),
		editor: fontClasses(textarea),
		placeholder: fontClasses(screen.queryByTestId("composer-placeholder")),
		painted: fontClasses(document.querySelector("[data-bash-highlight]")),
	};
}

describe("Composer bash mode font", () => {
	it("marks the composer root data-bash-mode=true and sets the editor, placeholder and painted command in mono", () => {
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		const chat = editorFonts(textarea);
		pressBang(textarea);
		const empty = editorFonts(textarea);
		fireEvent.change(textarea, {target: {value: "ls"}});

		expect({chat, empty, typed: editorFonts(textarea)}).toStrictEqual({
			chat: {root: null, card: false, editor: ["font-sans"], placeholder: ["font-sans"], painted: []},
			empty: {root: "true", card: false, editor: ["font-mono"], placeholder: ["font-mono"], painted: []},
			typed: {root: "true", card: false, editor: ["font-mono"], placeholder: [], painted: ["font-mono"]},
		});
	});
});

describe("Composer bash mode status region", () => {
	it("announces chat and bash mode in one sr-only status span instead of an aria-description", () => {
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		const chat = {status: statusTexts(), description: textarea.getAttribute("aria-description")};
		pressBang(textarea);
		const bash = statusTexts();
		fireEvent.keyDown(textarea, {key: "Backspace"});

		expect({chat, bash, back: statusTexts()}).toStrictEqual({
			chat: {status: ["Chat mode"], description: null},
			bash: ["Bash mode. Press Escape to return to chat."],
			back: ["Chat mode"],
		});
	});

	it("renders no status span where bash mode is unavailable", () => {
		renderComposer();

		expect(statusTexts()).toStrictEqual([]);
	});
});

describe("Composer bash mode history", () => {
	it("walks the bash history with ↑/↓ in bash mode and stays in bash mode", () => {
		const {textarea} = renderComposer({
			onShellCommand: ALLOW,
			promptHistory: ["Fix the tests"],
			bashHistory: ["git status", "ls -la"],
		});
		pressBang(textarea);
		fireEvent.keyDown(textarea, {key: "ArrowUp"});
		const newest = {value: textarea.value, bashMode: bashState(textarea).bashMode};
		fireEvent.keyDown(textarea, {key: "ArrowUp"});
		const older = textarea.value;
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		fireEvent.keyDown(textarea, {key: "ArrowDown"});

		expect({newest, older, back: {value: textarea.value, bashMode: bashState(textarea).bashMode}}).toStrictEqual({
			newest: {value: "git status", bashMode: true},
			older: "ls -la",
			back: {value: "", bashMode: true},
		});
	});

	it("keeps walking chat prompts in chat mode", () => {
		const {textarea} = renderComposer({
			onShellCommand: ALLOW,
			promptHistory: ["Fix the tests"],
			bashHistory: ["git status"],
		});
		fireEvent.keyDown(textarea, {key: "ArrowUp"});

		expect(textarea.value).toBe("Fix the tests");
	});

	it("resets an active walk when bash mode toggles", () => {
		const {textarea} = renderComposer({
			onShellCommand: ALLOW,
			promptHistory: ["Fix the tests"],
			bashHistory: ["git status"],
		});
		pressBang(textarea);
		fireEvent.keyDown(textarea, {key: "ArrowUp"});
		fireEvent.change(textarea, {target: {value: ""}});
		fireEvent.keyDown(textarea, {key: "Backspace"});
		fireEvent.keyDown(textarea, {key: "ArrowUp"});

		expect({value: textarea.value, bashMode: bashState(textarea).bashMode}).toStrictEqual({
			value: "Fix the tests",
			bashMode: false,
		});
	});
});

describe("Composer bash mode type-to-focus", () => {
	function blurToBody(): void {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	}

	it("enters bash mode for a ! typed outside any field into the empty composer", () => {
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		blurToBody();
		const dispatched = fireEvent.keyDown(document.body, {key: "!"});

		expect({
			dispatched,
			focused: document.activeElement === textarea,
			value: textarea.value,
			bashMode: bashState(textarea).bashMode,
		}).toStrictEqual({dispatched: false, focused: true, value: "", bashMode: true});
	});

	it("types the ! as text when the composer has text or no live pane", () => {
		const withText = renderComposer({onShellCommand: ALLOW});
		fireEvent.change(withText.textarea, {target: {value: "wow"}});
		blurToBody();
		fireEvent.keyDown(document.body, {key: "!"});
		const typed = {value: withText.textarea.value, bashMode: bashState(withText.textarea).bashMode};
		cleanup();
		localStorage.clear();
		const noPane = renderComposer();
		blurToBody();
		fireEvent.keyDown(document.body, {key: "!"});

		expect({
			typed,
			noPane: {value: noPane.textarea.value, bashMode: bashState(noPane.textarea).bashMode},
		}).toStrictEqual({typed: {value: "wow!", bashMode: false}, noPane: {value: "!", bashMode: false}});
	});
});

describe("Composer bash mode hidden characters", () => {
	it("refuses a command with hidden characters and keeps it in bash mode", async () => {
		const onShellCommand = vi.fn<(command: string) => Promise<boolean>>().mockResolvedValue(true);
		const {handlers, textarea} = renderComposer({onShellCommand});
		pressBang(textarea);
		fireEvent.change(textarea, {target: {value: "rm\u202Efoo"}});
		fireEvent.keyDown(textarea, {key: "Enter"});
		await flush();

		expect({
			commands: onShellCommand.mock.calls,
			toasts: handlers.toast.mock.calls,
			value: textarea.value,
			bashMode: bashState(textarea).bashMode,
		}).toStrictEqual({
			commands: [],
			toasts: [
				[
					{
						kind: "error",
						message: "This command contains hidden characters, so it wasn’t run. Retype it to run it.",
					},
				],
			],
			value: "rm\u202Efoo",
			bashMode: true,
		});
	});
});

function placeholderProbe() {
	const probe = document.querySelector<HTMLElement>("[data-placeholder-fit-probe]");
	if (probe === null) return null;
	return {
		text: probe.getAttribute("data-placeholder-fit-probe"),
		hidden: probe.getAttribute("aria-hidden"),
		className: probe.className,
	};
}

function stubProbeWidths(scrollWidth: number, clientWidth: number) {
	vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
		return this.hasAttribute("data-placeholder-fit-probe") ? scrollWidth : 0;
	});
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
		return this.hasAttribute("data-placeholder-fit-probe") ? clientWidth : 0;
	});
}

describe("Composer bash mode compact placeholder", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("probes the full placeholder in mono and keeps it while it fits", () => {
		stubProbeWidths(231, 231);
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		const chatProbe = placeholderProbe();
		pressBang(textarea);

		expect({
			chatProbe,
			probe: placeholderProbe(),
			probeFont: fontClasses(document.querySelector("[data-placeholder-fit-probe]")?.parentElement ?? null),
			placeholder: screen.getByTestId("composer-placeholder").textContent,
			ariaPlaceholder: textarea.getAttribute("aria-placeholder"),
			title: textarea.getAttribute("title"),
		}).toStrictEqual({
			chatProbe: null,
			probe: {
				text: BASH_PLACEHOLDER,
				hidden: "true",
				className: "invisible me-px whitespace-nowrap before:content-[attr(data-placeholder-fit-probe)]",
			},
			probeFont: ["font-mono"],
			placeholder: BASH_PLACEHOLDER,
			ariaPlaceholder: BASH_PLACEHOLDER,
			title: null,
		});
	});

	it("switches to upstream's compact text, with the full text as title, when the full one overflows", () => {
		stubProbeWidths(232, 231);
		const {textarea} = renderComposer({onShellCommand: ALLOW});
		pressBang(textarea);

		expect({
			placeholder: screen.getByTestId("composer-placeholder").textContent,
			ariaPlaceholder: textarea.getAttribute("aria-placeholder"),
			description: textarea.getAttribute("aria-description"),
			title: textarea.getAttribute("title"),
		}).toStrictEqual({
			placeholder: "Run, send output to Claude",
			ariaPlaceholder: "Run, send output to Claude",
			description: BASH_PLACEHOLDER,
			title: BASH_PLACEHOLDER,
		});
	});
});

describe("Composer shell commands without a live pane", () => {
	it("types ! as text when bash mode is unavailable", () => {
		const {textarea} = renderComposer();
		const notCancelled = pressBang(textarea);

		expect({notCancelled, bashMode: bashState(textarea).bashMode}).toStrictEqual({
			notCancelled: true,
			bashMode: false,
		});
	});

	it("refuses a `! command` send in a local session without a runner with upstream's feQzH0 message", () => {
		const {handlers, textarea} = renderComposer();
		fireEvent.change(textarea, {target: {value: "! ls"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			sent: handlers.onSend.mock.calls,
			toasts: handlers.toast.mock.calls,
			value: textarea.value,
		}).toStrictEqual({
			sent: [],
			toasts: [[{kind: "error", message: "Shell command runner unavailable."}]],
			value: "! ls",
		});
	});

	it("refuses a `! command` send on the home composer with upstream's start-a-session message", () => {
		const {handlers, textarea} = renderComposer({variant: "home"});
		fireEvent.change(textarea, {target: {value: "! ls"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({sent: handlers.onSend.mock.calls, toasts: handlers.toast.mock.calls}).toStrictEqual({
			sent: [],
			toasts: [[{kind: "error", message: "Start a local session first to run shell commands."}]],
		});
	});

	it("still sends a ! that isn't followed by whitespace", () => {
		const {handlers, textarea} = renderComposer();
		fireEvent.change(textarea, {target: {value: "!important"}});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect(handlers.onSend.mock.calls).toStrictEqual([["!important"]]);
	});
});

describe("composer-shell-command", () => {
	it("matches upstream's `! command` shape", () => {
		expect(["! ls", "!  git status", "!\tpwd", "!ls", "!", "! ", "ls"].map(isShellCommandText)).toStrictEqual([
			true,
			true,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("names upstream's refusal per composer", () => {
		expect([shellCommandUnavailableMessage("session"), shellCommandUnavailableMessage("home")]).toStrictEqual([
			"Shell command runner unavailable.",
			"Start a local session first to run shell commands.",
		]);
	});

	it("finds upstream's hidden characters, but not plain text or emoji ZWJ sequences", () => {
		expect(
			[
				"ls\u200B -la",
				"rm\u202Afoo",
				"rm\u202Efoo",
				"rm\u2066foo",
				"rm\u2069foo",
				"echo\u00A0hi",
				"ls -la",
				"echo 👨‍👩‍👧 done",
				"git commit -m 'a'\ngit push",
				"echo שלום",
			].map(hasHiddenCharacters),
		).toStrictEqual([true, true, true, true, true, true, false, false, false, false]);
	});

	it("types !<command> into the live pane through the prompt write path", async () => {
		const post = vi.fn<(sessionId: string, prompt: string) => Promise<void>>().mockResolvedValue(undefined);
		const toast = vi.fn<(options: ToastOptions) => void>();
		const ran = await runShellCommandInPane("session-alice", "ls -la", {post, toast});

		expect({ran, posts: post.mock.calls, toasts: toast.mock.calls}).toStrictEqual({
			ran: true,
			posts: [["session-alice", "!ls -la"]],
			toasts: [],
		});
	});

	it("reports a refused write and hands the command back", async () => {
		const post = vi
			.fn<(sessionId: string, prompt: string) => Promise<void>>()
			.mockRejectedValue(new HerdrRequestError("agent is not ready", 409, "agent_not_ready"));
		const toast = vi.fn<(options: ToastOptions) => void>();
		const ran = await runShellCommandInPane("session-alice", "ls", {post, toast});

		expect({ran, toasts: toast.mock.calls}).toStrictEqual({
			ran: false,
			toasts: [[{kind: "error", message: "Couldn’t run the shell command", description: "agent is not ready"}]],
		});
	});
});
