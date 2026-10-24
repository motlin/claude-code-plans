// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, renderHook, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {RewindPicker} from "../src/components/rewind-picker";
import {sendHerdrRewind} from "../src/lib/api/herdr";
import {useRewindPicker} from "../src/hooks/use-rewind-shortcut";
import {registerComposer} from "../src/lib/context-attach";
import {canOpenRewindPicker, rewindLabel, rewindStepsBack, rewindTurns} from "../src/lib/rewind-picker";
import {SESSION_SLASH_COMMANDS} from "../src/lib/slash-commands";

const TURNS = [
	{uuid: "u1", text: "Rename the button"},
	{uuid: "u2", text: "Add a test"},
	{uuid: "u3", text: "Fix the lint"},
];

function prompt(uuid: string, content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {type: "user", uuid, message: {role: "user", content}, ...extra};
}

beforeEach(() => {
	vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
	vi.setSystemTime(new Date("2026-10-24T18:00:00.000Z"));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("rewindTurns", () => {
	it("lists the active chain's user prompts with text, oldest first", () => {
		const records = [
			prompt("u1", "Rename the button"),
			{type: "assistant", uuid: "a1", message: {role: "assistant", content: [{type: "text", text: "Done"}]}},
			prompt("t1", [{type: "tool_result", tool_use_id: "x", content: "ok"}]),
			prompt("m1", "Caveat", {isMeta: true}),
			prompt("gone", "Abandoned prompt"),
			prompt("u2", [{type: "text", text: "Add a test"}]),
			prompt("c1", "This session is being continued", {isCompactSummary: true}),
			prompt("s1", "Side", {isSidechain: true}),
			prompt(
				"u3",
				"<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>",
			),
			prompt("blank", "   "),
		];
		expect(rewindTurns(records, new Set(["gone"]))).toStrictEqual([
			{uuid: "u1", text: "Rename the button"},
			{uuid: "u2", text: "Add a test"},
			{uuid: "u3", text: "/model opus"},
		]);
	});
});

describe("rewindLabel", () => {
	it("keeps a short prompt and cuts a long one at 80 characters with an ellipsis, as upstream's Cte", () => {
		const long = '[upstream-sync test] Reply with only the word "one". Do nothing else: no tools, no files.';
		expect([rewindLabel("Short"), rewindLabel(long)]).toStrictEqual([
			"Short",
			'[upstream-sync test] Reply with only the word "one". Do nothing else: no tools, …',
		]);
	});
});

describe("rewindStepsBack", () => {
	it("counts Up presses from the CLI's (current) row: 1 for the newest prompt", () => {
		expect([
			rewindStepsBack(TURNS, "u3"),
			rewindStepsBack(TURNS, "u2"),
			rewindStepsBack(TURNS, "u1"),
			rewindStepsBack(TURNS, "missing"),
		]).toStrictEqual([1, 2, 3, null]);
	});
});

describe("canOpenRewindPicker", () => {
	const idle = {available: true, busy: false, draft: "", now: 10_000, closedAt: null};
	it("opens on an idle session with an empty composer and refuses each of upstream's E_ gates", () => {
		expect({
			idle: canOpenRewindPicker(idle),
			whitespaceDraft: canOpenRewindPicker({...idle, draft: "  \n"}),
			draft: canOpenRewindPicker({...idle, draft: "half typed"}),
			busy: canOpenRewindPicker({...idle, busy: true}),
			unavailable: canOpenRewindPicker({...idle, available: false}),
			justClosed: canOpenRewindPicker({...idle, closedAt: 9_500}),
			closedLongAgo: canOpenRewindPicker({...idle, closedAt: 9_400}),
		}).toStrictEqual({
			idle: true,
			whitespaceDraft: true,
			draft: false,
			busy: false,
			unavailable: false,
			justClosed: false,
			closedLongAgo: true,
		});
	});
});

describe("useRewindPicker Esc Esc", () => {
	function escape(init: KeyboardEventInit = {}, target: EventTarget = document.body): KeyboardEvent {
		const event = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true, ...init});
		act(() => {
			target.dispatchEvent(event);
		});
		return event;
	}

	function setup({busy = false, draft = ""}: {busy?: boolean; draft?: string} = {}) {
		const unregister = registerComposer("session-alice", {
			insertText: () => {},
			focus: () => {},
			getText: () => draft,
		});
		const hook = renderHook(() => useRewindPicker({sessionId: "session-alice", available: true, busy}));
		return {hook, unregister};
	}

	it("opens on two plain Escapes 300ms apart and prevents the second's default", () => {
		const {hook, unregister} = setup();
		const first = escape();
		vi.advanceTimersByTime(300);
		const second = escape();
		expect({
			open: hook.result.current.open,
			used: hook.result.current.used,
			first: first.defaultPrevented,
			second: second.defaultPrevented,
		}).toStrictEqual({open: true, used: true, first: false, second: true});
		unregister();
	});

	it("does nothing for Escapes 600ms apart", () => {
		const {hook, unregister} = setup();
		escape();
		vi.advanceTimersByTime(600);
		escape();
		expect(hook.result.current.open).toBe(false);
		unregister();
	});

	it("does nothing with draft text in the composer", () => {
		const {hook, unregister} = setup({draft: "half typed"});
		escape();
		escape();
		expect(hook.result.current.open).toBe(false);
		unregister();
	});

	it("does nothing while the pane is busy", () => {
		const {hook, unregister} = setup({busy: true});
		escape();
		escape();
		expect(hook.result.current.open).toBe(false);
		unregister();
	});

	it("ignores repeats, modified and composing Escapes", () => {
		const {hook, unregister} = setup();
		escape();
		escape({repeat: true});
		escape();
		escape({shiftKey: true});
		escape();
		escape({isComposing: true});
		expect(hook.result.current.open).toBe(false);
		unregister();
	});

	it("ignores Escapes inside the terminal ([role=application] or canvas)", () => {
		const {hook, unregister} = setup();
		const terminal = document.createElement("div");
		terminal.setAttribute("role", "application");
		const inner = document.createElement("textarea");
		terminal.append(inner);
		document.body.append(terminal);
		escape({}, inner);
		escape({}, inner);
		expect(hook.result.current.open).toBe(false);
		terminal.remove();
		unregister();
	});

	it("refuses to reopen within 600ms of closing", () => {
		const {hook, unregister} = setup();
		act(() => {
			hook.result.current.requestOpen();
		});
		act(() => {
			hook.result.current.close();
		});
		vi.advanceTimersByTime(500);
		act(() => {
			hook.result.current.requestOpen();
		});
		const reopenedEarly = hook.result.current.open;
		vi.advanceTimersByTime(200);
		act(() => {
			hook.result.current.requestOpen();
		});
		expect({reopenedEarly, reopenedLater: hook.result.current.open}).toStrictEqual({
			reopenedEarly: false,
			reopenedLater: true,
		});
		unregister();
	});

	it("opens from /rewind even though the composer still held the command when it was sent", () => {
		const {hook, unregister} = setup({draft: "/rewind"});
		act(() => {
			hook.result.current.requestOpen({fromComposer: true});
		});
		expect(hook.result.current.open).toBe(true);
		unregister();
	});
});

describe("RewindPicker", () => {
	const scrollIntoView = vi.fn<Element["scrollIntoView"]>();
	beforeEach(() => {
		// Base UI moves initial focus on a timer.
		vi.useRealTimers();
		scrollIntoView.mockClear();
		Element.prototype.scrollIntoView = scrollIntoView;
	});

	function renderPicker(turns = TURNS) {
		const onSelect = vi.fn<(uuid: string, text: string) => void>();
		const onClose = vi.fn<() => void>();
		render(<RewindPicker open turns={turns} onClose={onClose} onSelect={onSelect} />);
		return {onSelect, onClose};
	}

	it("renders upstream's dialog with the last turn selected and the listbox focused", async () => {
		renderPicker();
		await waitFor(() => {
			expect(document.activeElement).toBe(screen.getByRole("listbox"));
		});
		const dialog = screen.getByRole("dialog");
		const listbox = screen.getByRole("listbox");
		const options = screen.getAllByRole("option");
		expect({
			label: dialog.getAttribute("aria-label"),
			title: screen.getByRole("heading").textContent,
			description: screen.getByText("Restore the session to an earlier message.").tagName,
			close: screen.getByRole("button", {name: "Close"}).tagName,
			activeDescendant: listbox.getAttribute("aria-activedescendant"),
			options: options.map((option) => ({
				id: option.id,
				idx: option.dataset["idx"],
				selected: option.getAttribute("aria-selected"),
				className: option.className,
				label: option.textContent,
			})),
		}).toStrictEqual({
			label: "Rewind session",
			title: "Rewind",
			description: "P",
			close: "BUTTON",
			activeDescendant: "rewind-opt-2",
			options: [
				{
					id: "rewind-opt-0",
					idx: "0",
					selected: "false",
					className: "rounded-r4 px-[6px] py-[5px] text-secondary",
					label: "Rename the button",
				},
				{
					id: "rewind-opt-1",
					idx: "1",
					selected: "false",
					className: "rounded-r4 px-[6px] py-[5px] text-secondary",
					label: "Add a test",
				},
				{
					id: "rewind-opt-2",
					idx: "2",
					selected: "true",
					className: "rounded-r4 px-[6px] py-[5px] bg-fill-ghost-hover text-primary",
					label: "Fix the lint",
				},
			],
		});
	});

	it("moves with ArrowUp/ArrowDown, clamped, and Enter picks the previous turn after closing", () => {
		const {onSelect, onClose} = renderPicker();
		const listbox = screen.getByRole("listbox");
		fireEvent.keyDown(listbox, {key: "ArrowDown"});
		const clampedAtEnd = listbox.getAttribute("aria-activedescendant");
		fireEvent.keyDown(listbox, {key: "ArrowUp"});
		fireEvent.keyDown(listbox, {key: "Enter"});
		expect({
			clampedAtEnd,
			closed: onClose.mock.calls.length,
			selected: onSelect.mock.calls,
			order: onClose.mock.invocationCallOrder[0]! < onSelect.mock.invocationCallOrder[0]!,
		}).toStrictEqual({
			clampedAtEnd: "rewind-opt-2",
			closed: 1,
			selected: [["u2", "Add a test"]],
			order: true,
		});
	});

	it("clamps ArrowUp at the first turn and scrolls each selected row into view", () => {
		renderPicker();
		const listbox = screen.getByRole("listbox");
		for (let press = 0; press < 5; press++) fireEvent.keyDown(listbox, {key: "ArrowUp"});
		expect({
			activeDescendant: listbox.getAttribute("aria-activedescendant"),
			scrolled: scrollIntoView.mock.contexts.map((row) => (row as Element).id),
			options: scrollIntoView.mock.calls.at(-1),
		}).toStrictEqual({
			activeDescendant: "rewind-opt-0",
			scrolled: ["rewind-opt-2", "rewind-opt-1", "rewind-opt-0"],
			options: [{block: "nearest"}],
		});
	});

	it("selects on hover and picks on click", () => {
		const {onSelect} = renderPicker();
		const first = screen.getAllByRole("option")[0]!;
		fireEvent.mouseEnter(first);
		const activeDescendant = screen.getByRole("listbox").getAttribute("aria-activedescendant");
		fireEvent.click(first);
		expect({activeDescendant, selected: onSelect.mock.calls}).toStrictEqual({
			activeDescendant: "rewind-opt-0",
			selected: [["u1", "Rename the button"]],
		});
	});

	it("shows the pre-truncated label but sends the full text", () => {
		const text = "x".repeat(100);
		const {onSelect} = renderPicker([{uuid: "u1", text}]);
		const option = screen.getByRole("option");
		fireEvent.click(option);
		expect({label: option.textContent, selected: onSelect.mock.calls}).toStrictEqual({
			label: `${"x".repeat(80)}…`,
			selected: [["u1", text]],
		});
	});

	it("shows upstream's empty row with no turns", () => {
		renderPicker([]);
		const empty = screen.getByText("Nothing to rewind to yet");
		expect({
			role: empty.getAttribute("role"),
			className: empty.className,
			activeDescendant: screen.getByRole("listbox").getAttribute("aria-activedescendant"),
		}).toStrictEqual({
			role: "presentation",
			className: "text-body text-muted-as-secondary italic px-[6px] py-[5px]",
			activeDescendant: null,
		});
	});
});

describe("/rewind", () => {
	it("is a session-only built-in slash command with upstream's description", () => {
		expect(SESSION_SLASH_COMMANDS.find((command) => command.name === "rewind")).toStrictEqual({
			name: "rewind",
			description: "Rewind the session to an earlier message",
			source: "builtin",
		});
	});
});

describe("sendHerdrRewind", () => {
	it("posts the target to /api/herdr/rewind and throws the server's reason on refusal", async () => {
		const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
			Promise.resolve(
				JSON.parse(String(init?.body)).stepsBack === 1
					? Response.json({ok: true})
					: Response.json({error: "Can’t rewind to this message."}, {status: 409}),
			),
		);
		await sendHerdrRewind("session-alice", {stepsBack: 1, text: "Fix the lint"}, fetcher);
		const refusal = await sendHerdrRewind("session-alice", {stepsBack: 2, text: "Add a test"}, fetcher).catch(
			(error: unknown) => (error instanceof Error ? error.message : null),
		);
		expect({
			calls: fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.body]),
			refusal,
		}).toStrictEqual({
			calls: [
				["/api/herdr/rewind", "POST", '{"sessionId":"session-alice","stepsBack":1,"text":"Fix the lint"}'],
				["/api/herdr/rewind", "POST", '{"sessionId":"session-alice","stepsBack":2,"text":"Add a test"}'],
			],
			refusal: "Can’t rewind to this message.",
		});
	});
});
