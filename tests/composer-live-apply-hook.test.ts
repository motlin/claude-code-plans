// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {type LiveLaunchOptionsInput, useLiveLaunchOptions} from "../src/hooks/use-live-launch-options";
import {useFolderModeMemory} from "../src/hooks/use-folder-mode-memory";
import {FOLDER_PERMISSION_MODE_STORAGE_KEY} from "../src/lib/folder-permission-mode";
import {installLocalStorage} from "./fake-storage";
import type {LaunchPermissionMode, LiveOptionChange} from "../src/lib/launch-options";

afterEach(() => {
	cleanup();
});

const WITHOUT_BYPASS: LaunchPermissionMode[] = ["auto", "default", "acceptEdits", "plan"];

type Send = (sessionId: string, change: LiveOptionChange) => Promise<void>;

function renderLive(initial: Partial<LiveLaunchOptionsInput> & {send: Send}) {
	const toast = vi.fn<LiveLaunchOptionsInput["toast"]>();
	const base: LiveLaunchOptionsInput = {
		sessionId: "session-ivan",
		currentMode: "default",
		availableModes: WITHOUT_BYPASS,
		hookContext: {permissionMode: "default", promptId: "prompt-1"},
		toast,
		...initial,
	};
	const hook = renderHook((props: LiveLaunchOptionsInput) => useLiveLaunchOptions(props), {
		initialProps: base,
	});
	return {...hook, toast, base};
}

describe("useLiveLaunchOptions", () => {
	it("sends model and effort as slash prompts and shows them in the chin", async () => {
		const send = vi.fn<Send>(async () => {});
		const {result, toast} = renderLive({send});

		await act(async () => result.current.apply({model: "fable"}));
		await act(async () => result.current.apply({model: "fable", effort: "max"}));

		expect({
			sends: send.mock.calls,
			options: result.current.options,
			toasts: toast.mock.calls,
		}).toStrictEqual({
			sends: [
				["session-ivan", {kind: "model", model: "fable"}],
				["session-ivan", {kind: "effort", effort: "max"}],
			],
			options: {model: "fable", effort: "max"},
			toasts: [],
		});
	});

	it("presses shift+tab and toasts when the next hook permission_mode disagrees", async () => {
		const send = vi.fn<Send>(async () => {});
		const {result, rerender, toast, base} = renderLive({send});

		await act(async () => result.current.apply({permissionMode: "plan"}));
		const beforeHook = result.current.options;
		rerender({...base, hookContext: {permissionMode: "acceptEdits", promptId: "prompt-2"}});

		expect({
			sends: send.mock.calls,
			beforeHook,
			afterHook: result.current.options,
			toasts: toast.mock.calls,
		}).toStrictEqual({
			sends: [["session-ivan", {kind: "mode", presses: 2}]],
			beforeHook: {permissionMode: "plan"},
			afterHook: {},
			toasts: [
				[
					{
						kind: "error",
						message: "Mode change couldn’t be applied. You can try again.",
						description: "Claude Code reports Accept edits instead of Plan.",
					},
				],
			],
		});
	});

	it("stays quiet when the next hook confirms the mode", async () => {
		const send = vi.fn<Send>(async () => {});
		const {result, rerender, toast, base} = renderLive({send});

		await act(async () => result.current.apply({permissionMode: "acceptEdits"}));
		rerender({...base, hookContext: {permissionMode: "acceptEdits", promptId: "prompt-2"}});

		expect({options: result.current.options, toasts: toast.mock.calls}).toStrictEqual({
			options: {},
			toasts: [],
		});
	});

	it("toasts the upstream copy when the pane rejects an effort change", async () => {
		const send = vi.fn<Send>(async () => Promise.reject(new Error("agent is busy")));
		const {result, toast} = renderLive({send});

		await act(async () => result.current.apply({effort: "low"}));

		expect({options: result.current.options, toasts: toast.mock.calls}).toStrictEqual({
			options: {},
			toasts: [
				[
					{
						kind: "error",
						message: "Effort change couldn’t be applied. You can try again.",
						description: "agent is busy",
					},
				],
			],
		});
	});

	it("sends /fast on and off and shows the pick in the chin", async () => {
		const send = vi.fn<Send>(async () => {});
		const {result, toast} = renderLive({send});

		await act(async () => result.current.apply({fastMode: true}));
		const afterOn = result.current.options;
		await act(async () => result.current.apply({fastMode: false}));

		expect({
			sends: send.mock.calls,
			afterOn,
			afterOff: result.current.options,
			toasts: toast.mock.calls,
		}).toStrictEqual({
			sends: [
				["session-ivan", {kind: "fast", on: true}],
				["session-ivan", {kind: "fast", on: false}],
			],
			afterOn: {fastMode: true},
			afterOff: {fastMode: false},
			toasts: [],
		});
	});

	it("toggles Ultracode with /effort ultracode on and off, keeping the effort", async () => {
		const send = vi.fn<Send>(async () => {});
		const {result, toast} = renderLive({send});

		await act(async () => result.current.apply({effort: "high"}));
		await act(async () => result.current.apply({effort: "high", ultracode: true}));
		const afterOn = result.current.options;
		await act(async () => result.current.apply({effort: "high", ultracode: false}));

		expect({
			sends: send.mock.calls,
			afterOn,
			afterOff: result.current.options,
			toasts: toast.mock.calls,
		}).toStrictEqual({
			sends: [
				["session-ivan", {kind: "effort", effort: "high"}],
				["session-ivan", {kind: "ultracode", on: true}],
				["session-ivan", {kind: "ultracode", on: false}],
			],
			afterOn: {effort: "high", ultracode: true},
			afterOff: {effort: "high", ultracode: false},
			toasts: [],
		});
	});

	it("drops the fast pick when the live model switches to one without fast mode", async () => {
		const send = vi.fn<Send>(async () => {});
		const {result} = renderLive({send});

		await act(async () => result.current.apply({fastMode: true}));
		await act(async () => result.current.apply({fastMode: true, model: "sonnet"}));

		expect({sends: send.mock.calls, options: result.current.options}).toStrictEqual({
			sends: [
				["session-ivan", {kind: "fast", on: true}],
				["session-ivan", {kind: "model", model: "sonnet"}],
			],
			options: {model: "sonnet"},
		});
	});

	it("toasts the upstream copy when the pane rejects a fast mode change", async () => {
		const send = vi.fn<Send>(async () => Promise.reject(new Error("agent is busy")));
		const {result, toast} = renderLive({send});

		await act(async () => result.current.apply({fastMode: true}));

		expect({options: result.current.options, toasts: toast.mock.calls}).toStrictEqual({
			options: {},
			toasts: [
				[
					{
						kind: "error",
						message: "Fast mode couldn’t be applied. You can try again.",
						description: "agent is busy",
					},
				],
			],
		});
	});

	it("shows an expected mode until the next hook reports it, toasting when the CLI reports another", () => {
		const send = vi.fn<Send>(async () => {});
		const {result, rerender, toast, base} = renderLive({send});

		act(() => {
			result.current.expectMode("auto");
		});
		const beforeHook = result.current.options;
		rerender({...base, hookContext: {permissionMode: "acceptEdits", promptId: "prompt-2"}});

		expect({
			sends: send.mock.calls,
			beforeHook,
			afterHook: result.current.options,
			toasts: toast.mock.calls,
		}).toStrictEqual({
			sends: [],
			beforeHook: {permissionMode: "auto"},
			afterHook: {},
			toasts: [
				[
					{
						kind: "error",
						message: "Mode change couldn’t be applied. You can try again.",
						description: "Claude Code reports Accept edits instead of Auto.",
					},
				],
			],
		});
	});

	it("clears an expected mode quietly once the hook reports it", () => {
		const {result, rerender, toast, base} = renderLive({send: vi.fn<Send>(async () => {})});

		act(() => {
			result.current.expectMode("auto");
		});
		rerender({...base, hookContext: {permissionMode: "auto", promptId: "prompt-2"}});

		expect({options: result.current.options, toasts: toast.mock.calls}).toStrictEqual({options: {}, toasts: []});
	});
});

describe("session mode picks remember the session's folder", () => {
	const WORKTREE = "/w/.claude/worktrees/x";

	function renderSession(send: Send) {
		installLocalStorage();
		const toast = vi.fn<LiveLaunchOptionsInput["toast"]>();
		const base: LiveLaunchOptionsInput = {
			sessionId: "session-ivan",
			currentMode: "default",
			availableModes: WITHOUT_BYPASS,
			hookContext: {permissionMode: "default", promptId: "prompt-1"},
			toast,
			send,
		};
		const hook = renderHook(
			(props: LiveLaunchOptionsInput) => {
				const memory = useFolderModeMemory(WORKTREE);
				const live = useLiveLaunchOptions({...props, onModeFailed: memory.rollback});
				return {
					pick: async (mode: LaunchPermissionMode) => {
						memory.remember(mode);
						await live.apply({permissionMode: mode});
					},
				};
			},
			{initialProps: base},
		);
		return {...hook, base};
	}

	function stored(): unknown {
		const raw = localStorage.getItem(FOLDER_PERMISSION_MODE_STORAGE_KEY);
		return raw === null ? null : JSON.parse(raw);
	}

	it("writes a worktree session's pick under its repo and rolls it back when the CLI reports another mode", async () => {
		const {result, rerender, base} = renderSession(vi.fn<Send>(async () => {}));

		await act(async () => result.current.pick("acceptEdits"));
		const afterPick = stored();
		rerender({...base, hookContext: {permissionMode: "default", promptId: "prompt-2"}});

		expect({afterPick, afterMismatch: stored()}).toStrictEqual({
			afterPick: {"/w": "acceptEdits"},
			afterMismatch: {},
		});
	});

	it("restores the previous entry when the live switch fails", async () => {
		const {result} = renderSession(vi.fn<Send>(async () => Promise.reject(new Error("pane busy"))));
		localStorage.setItem(FOLDER_PERMISSION_MODE_STORAGE_KEY, JSON.stringify({"/w": "auto"}));

		await act(async () => result.current.pick("acceptEdits"));

		expect(stored()).toStrictEqual({"/w": "auto"});
	});

	it("keeps a second pick made before the first one failed", async () => {
		let failFirst: (error: Error) => void = () => {};
		const send = vi
			.fn<Send>()
			.mockImplementationOnce(
				async () =>
					new Promise<void>((_resolve, reject) => {
						failFirst = reject;
					}),
			)
			.mockImplementation(async () => {});
		const {result} = renderSession(send);

		let first: Promise<void> = Promise.resolve();
		act(() => {
			first = result.current.pick("acceptEdits");
		});
		await act(async () => result.current.pick("auto"));
		await act(async () => {
			failFirst(new Error("pane busy"));
			await first;
		});

		expect(stored()).toStrictEqual({"/w": "auto"});
	});
});
