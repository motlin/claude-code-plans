// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {RewindConfirm} from "../src/components/rewind-confirm";
import {ToastProvider} from "../src/components/toast";
import {type RewindRequestDependencies, useRewindRequest} from "../src/hooks/use-rewind-request";
import type {RewindFileChanges} from "../src/lib/api/rewind-files";

const FILES: RewindFileChanges = {filesChanged: ["/repo/a.txt", "/repo/b.txt"], insertions: 4, deletions: 3};

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return {promise, resolve};
}

type Preview = Awaited<ReturnType<RewindRequestDependencies["fetchPreview"]>>;
type Restore = Awaited<ReturnType<RewindRequestDependencies["restoreCode"]>>;

function setup({conversation = true}: {conversation?: boolean} = {}) {
	const preview = deferred<Preview>();
	const restore = deferred<Restore>();
	const conversationRun = deferred<undefined>();
	const fetchPreview = vi.fn<RewindRequestDependencies["fetchPreview"]>(async () => preview.promise);
	const restoreCode = vi.fn<RewindRequestDependencies["restoreCode"]>(async () => restore.promise);
	const run = vi.fn<(uuid: string, text: string, afterCode: boolean) => Promise<void>>(
		async () => conversationRun.promise,
	);

	function Harness() {
		const rewind = useRewindRequest({
			sessionId: "session-alice",
			conversationAvailable: conversation,
			runConversationRewind: run,
			dependencies: {fetchPreview, restoreCode},
		});
		return (
			<>
				<button
					type="button"
					onClick={() => {
						rewind.requestRewind("u2", "  Add a test  ");
					}}
				>
					request
				</button>
				{rewind.rewindConfirm !== null && (
					<RewindConfirm
						text={rewind.rewindConfirm.text}
						preview={rewind.rewindConfirm.preview}
						conversation={conversation}
						onClose={rewind.closeRewindConfirm}
						onConfirm={rewind.confirmRewind}
					/>
				)}
			</>
		);
	}

	render(
		<ToastProvider>
			<Harness />
		</ToastProvider>,
	);
	fireEvent.click(screen.getByRole("button", {name: "request"}));
	return {preview, restore, conversationRun, fetchPreview, restoreCode, run};
}

async function advance(ms: number): Promise<void> {
	await act(async () => {
		vi.advanceTimersByTime(ms);
		await Promise.resolve();
	});
}

async function settle(): Promise<void> {
	await act(async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	});
}

function dialog(): HTMLElement | null {
	return screen.queryByRole("dialog");
}

function toasts(): string[] {
	return [...document.querySelectorAll("[data-toast-message]")].map((toast) => toast.textContent);
}

function fileColumn(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[aria-live="polite"].flex-col');
}

function restoreTrigger(): HTMLElement | null {
	return screen.queryByRole("combobox", {name: "Restore"});
}

async function openRestore(trigger: HTMLElement): Promise<void> {
	fireEvent.click(trigger);
	await advance(0);
}

/** Opens upstream's styled Restore select and picks the option with this label. */
async function pickRestore(label: string): Promise<void> {
	const trigger = restoreTrigger();
	if (trigger === null) throw new Error("no Restore select");
	await openRestore(trigger);
	/* jsdom has no layout, so the positioned popup reads as hidden. */
	const option = screen.getByRole("option", {name: label, hidden: true});
	fireEvent.pointerDown(option, {pointerType: "mouse"});
	fireEvent.click(option);
	await settle();
}

function view() {
	const trigger = restoreTrigger();
	return {
		title: dialog()?.querySelector("h2")?.textContent ?? null,
		quote: dialog()?.querySelector("p.line-clamp-2")?.textContent ?? null,
		select:
			trigger === null
				? null
				: {
						value: trigger.textContent,
						disabled: trigger.hasAttribute("data-disabled"),
					},
		column: fileColumn()?.textContent ?? null,
	};
}

beforeEach(() => {
	vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout", "Date"]});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("useRewindRequest + RewindConfirm", () => {
	it("rewinds the conversation at once, with no dialog, when nothing changed and the preview took under 400ms", async () => {
		const {preview, fetchPreview, run} = setup();
		await advance(100);
		preview.resolve(null);
		await settle();

		expect({
			dialog: dialog(),
			previews: fetchPreview.mock.calls,
			runs: run.mock.calls,
		}).toStrictEqual({
			dialog: null,
			previews: [["session-alice", "u2"]],
			runs: [["u2", "  Add a test  ", false]],
		});
	});

	it("shows the dialog, still checking, once the preview takes 400ms, then drops the select when nothing changed", async () => {
		const {preview, run} = setup();
		await advance(399);
		const before = dialog();
		await advance(1);
		const checking = view();
		preview.resolve(null);
		await settle();
		const none = view();
		fireEvent.click(screen.getByRole("button", {name: "Rewind"}));
		await settle();

		expect({before, checking, none, runs: run.mock.calls}).toStrictEqual({
			before: null,
			checking: {
				title: "Rewind to this message?",
				quote: "Add a test",
				select: {value: "Code and conversation", disabled: true},
				column: "Checking for file changes…Changes made through shell commands aren’t reverted. Commits stay in place.",
			},
			none: {title: "Rewind to this message?", quote: "Add a test", select: null, column: null},
			runs: [["u2", "  Add a test  ", false]],
		});
	});

	it("offers the Restore select when files changed, with Cancel focused, and hides the count for Conversation only", async () => {
		const {preview} = setup();
		preview.resolve(FILES);
		await settle();
		const files = view();
		const cancel = screen.getByRole("button", {name: "Cancel"});
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(cancel);
		});
		const cancelFocused = document.activeElement === cancel;
		await pickRestore("Conversation only");

		expect({files, cancelFocused, hidden: fileColumn()?.classList.contains("invisible")}).toStrictEqual({
			files: {
				title: "Rewind to this message?",
				quote: "Add a test",
				select: {value: "Code and conversation", disabled: false},
				column: "2 files · +4−3Changes made through shell commands aren’t reverted. Commits stay in place.",
			},
			cancelFocused: true,
			hidden: true,
		});
	});

	it("renders Restore as upstream's styled Combobox select: labelled trigger with caret, check-marked listbox options", async () => {
		const {preview} = setup();
		preview.resolve(FILES);
		await settle();
		const trigger = restoreTrigger();
		const field = trigger?.closest("[data-cds='Combobox']");
		const label = screen.getByText("Restore", {selector: "label"});
		const closed = {
			labelFor: label.getAttribute("for") === trigger?.id,
			labelClass: label.className,
			fieldClass: field?.className ?? null,
			triggerClass: trigger?.className ?? null,
			caret: trigger?.querySelector("svg") !== null,
		};
		await pickRestore("Code only");
		const picked = restoreTrigger()?.textContent;
		await openRestore(restoreTrigger() ?? document.body);
		const listbox = screen.getByRole("listbox", {hidden: true});
		const options = screen.getAllByRole("option", {hidden: true}).map((option) => ({
			name: option.textContent,
			selected: option.getAttribute("aria-selected"),
			check: option.querySelector("svg") !== null,
		}));

		expect({closed, picked, popup: listbox.closest("[data-cds='Combobox']") !== null, options}).toStrictEqual({
			closed: {
				labelFor: true,
				labelClass: "text-body text-primary font-medium leading-none",
				fieldClass:
					"group/cbx inline-flex items-center gap-1.5 h-8 rounded-r6 font-sans text-body font-normal text-primary outline-none transition data-[disabled]:opacity-50 data-[disabled]:pointer-events-none bg-fill-field shadow-field-ring [&:hover:not(:has(:focus-visible)):not([data-disabled])]:shadow-field-hover ps-0 has-[:focus-visible]:shadow-focus pe-2 w-full min-w-0",
				triggerClass:
					"flex min-w-0 flex-1 items-center gap-1.5 self-stretch ps-2 text-start border-0 bg-transparent p-0 outline-none focus-visible:outline-hidden",
				caret: true,
			},
			picked: "Code only",
			popup: true,
			options: [
				{name: "Code and conversation", selected: "false", check: false},
				{name: "Conversation only", selected: "false", check: false},
				{name: "Code only", selected: "true", check: true},
			],
		});
	});

	it("restores the code, then the conversation, holding the dialog busy until both finish", async () => {
		const {preview, restore, conversationRun, restoreCode, run} = setup();
		preview.resolve(FILES);
		await settle();
		fireEvent.click(screen.getByRole("button", {name: "Rewind"}));
		await settle();
		const busy = screen.getByRole("button", {name: "Rewinding…"});
		const whileRestoring = {
			busy: busy.getAttribute("aria-busy"),
			cancelDisabled: screen.getByRole("button", {name: "Cancel"}).hasAttribute("disabled"),
			restores: restoreCode.mock.calls.length,
			runs: run.mock.calls.length,
		};
		fireEvent.keyDown(document.activeElement ?? document.body, {key: "Escape"});
		const stillOpen = dialog() !== null;
		restore.resolve({ok: true, skipped: 0});
		await settle();
		const runs = [...run.mock.calls];
		conversationRun.resolve(undefined);
		await settle();

		expect({whileRestoring, stillOpen, runs, closed: dialog(), toasts: toasts()}).toStrictEqual({
			whileRestoring: {busy: "true", cancelDisabled: true, restores: 1, runs: 0},
			stillOpen: true,
			runs: [["u2", "  Add a test  ", true]],
			closed: null,
			toasts: [],
		});
	});

	it("restores only the code for Code only, toasting Code restored", async () => {
		const {preview, restore, restoreCode, run} = setup();
		preview.resolve(FILES);
		await settle();
		await pickRestore("Code only");
		fireEvent.click(screen.getByRole("button", {name: "Rewind"}));
		restore.resolve({ok: true, skipped: 0});
		await settle();

		expect({
			restores: restoreCode.mock.calls,
			runs: run.mock.calls,
			dialog: dialog(),
			toasts: toasts(),
		}).toStrictEqual({
			restores: [["session-alice", "u2"]],
			runs: [],
			dialog: null,
			toasts: ["Code restored"],
		});
	});

	it("keeps the dialog open with upstream's error when the code restore fails", async () => {
		const {preview, restore, run} = setup();
		preview.resolve(FILES);
		await settle();
		fireEvent.click(screen.getByRole("button", {name: "Rewind"}));
		restore.resolve({ok: false, inFlight: false});
		await settle();

		expect({open: dialog() !== null, runs: run.mock.calls, toasts: toasts()}).toStrictEqual({
			open: true,
			runs: [],
			toasts: ["Couldn’t restore the code from this point. Try again."],
		});
	});

	it("warns about skipped files after a restore", async () => {
		const {preview, restore} = setup();
		preview.resolve(FILES);
		await settle();
		await pickRestore("Code only");
		fireEvent.click(screen.getByRole("button", {name: "Rewind"}));
		restore.resolve({ok: true, skipped: 2});
		await settle();

		expect(toasts()).toStrictEqual([
			"Restored the code, but skipped 2 files that couldn’t be safely written. Skipped files were left untouched.",
		]);
	});

	it("shows a Rewinding… toast while a run passes 400ms, and clears it when done", async () => {
		const {preview, conversationRun} = setup();
		preview.resolve(null);
		await settle();
		const early = toasts();
		await advance(400);
		const late = toasts();
		conversationRun.resolve(undefined);
		await settle();

		expect({early, late, done: toasts()}).toStrictEqual({early: [], late: ["Rewinding…"], done: []});
	});

	it("warns, without a dialog, while an earlier code restore is still running", async () => {
		const {preview, run} = setup();
		preview.resolve("restoring");
		await settle();

		expect({dialog: dialog(), runs: run.mock.calls, toasts: toasts()}).toStrictEqual({
			dialog: null,
			runs: [],
			toasts: ["Still restoring the code from an earlier rewind…"],
		});
	});

	it("without a live terminal, refuses a rewind with no code to restore", async () => {
		const {preview, run} = setup({conversation: false});
		preview.resolve(null);
		await settle();

		expect({dialog: dialog(), runs: run.mock.calls, toasts: toasts()}).toStrictEqual({
			dialog: null,
			runs: [],
			toasts: ["Rewind is unavailable while the computer running this session is offline"],
		});
	});

	it("without a live terminal, offers only the code restore, with no select", async () => {
		const {preview, restore, restoreCode, run} = setup({conversation: false});
		preview.resolve(FILES);
		await settle();
		const offered = view();
		fireEvent.click(screen.getByRole("button", {name: "Rewind"}));
		restore.resolve({ok: true, skipped: 0});
		await settle();

		expect({offered, restores: restoreCode.mock.calls.length, runs: run.mock.calls}).toStrictEqual({
			offered: {
				title: "Rewind to this message?",
				quote: "Add a test",
				select: null,
				column: "2 files · +4−3Changes made through shell commands aren’t reverted. Commits stay in place.",
			},
			restores: 1,
			runs: [],
		});
	});

	it("cancels without running anything", async () => {
		const {preview, restoreCode, run} = setup();
		preview.resolve(FILES);
		await settle();
		fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
		await settle();

		expect({dialog: dialog(), restores: restoreCode.mock.calls, runs: run.mock.calls}).toStrictEqual({
			dialog: null,
			restores: [],
			runs: [],
		});
	});
});
