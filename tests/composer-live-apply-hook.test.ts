// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {type LiveLaunchOptionsInput, useLiveLaunchOptions} from "../src/hooks/use-live-launch-options";
import type {LaunchPermissionMode, LiveOptionChange} from "../src/lib/launch-options";

afterEach(() => {
	cleanup();
});

const WITHOUT_BYPASS: LaunchPermissionMode[] = ["auto", "default", "acceptEdits", "plan"];

type Send = (sessionId: string, change: LiveOptionChange) => Promise<void>;

function renderLive(initial: Partial<LiveLaunchOptionsInput> & {send: Send}) {
	const toast = vi.fn();
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
		const send = vi.fn<Send>(async () => {
			throw new Error("agent is busy");
		});
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
});
