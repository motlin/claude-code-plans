// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import type {HardBlock} from "../src/lib/hard-block";
import type {RewindTurn} from "../src/lib/rewind-picker";

const mocks = vi.hoisted(() => (
{
	getComposerText: vi.fn<(sessionId: string) => string | null>(),
	focusComposer: vi.fn<(sessionId: string) => boolean>(),
	composerInBashMode: vi.fn<(sessionId: string) => boolean>(),
}));

vi.mock("../src/lib/context-attach", async (importOriginal) => (
{
	...(await importOriginal<typeof import("../src/lib/context-attach")>()),
	getComposerText: mocks.getComposerText,
	focusComposer: mocks.focusComposer,
	composerInBashMode: mocks.composerInBashMode,
}));

const {useHardBlockEditRetry} = await import("../src/hooks/use-hard-block-edit-retry");

const TURNS: RewindTurn[] = [
	{
		uuid: "p0",
		text: "first",
	},
	{
		uuid: "p1",
		text: "write the exploit",
	},
];

const BLOCK: HardBlock =
{
	uuid: "r1",
	model: null,
	hasMessage: true,
};

type Rewind = (uuid: string, text: string, afterCode: boolean) => Promise<void>;

let toasts: ToastOptions[] = [];

function pushToast(options: ToastOptions)
{
	toasts.push(options);
}

function wrapper({children}: {children: ReactNode})
{
	return <ToastContext.Provider value={pushToast}>{children}</ToastContext.Provider>;
}

interface Options
{
	available?: boolean;
	busy?: boolean;
	block?: HardBlock | null;
	rewind?: (uuid: string, text: string, afterCode: boolean) => Promise<void>;
}

function setup({available = true, busy = false, block = BLOCK, rewind = vi.fn<Rewind>(async () => {})}: Options = {})
{
	const view = renderHook(
		() =>
			useHardBlockEditRetry(
				{
					sessionId: "s1",
					available,
					busy,
					block,
					turns: TURNS,
					runConversationRewind: rewind,
				},
			),
		{
			wrapper,
		},
	);
	const retry = (uuid = "r1"): boolean =>
	{
		const handler = view.result.current.onEditRetry;
		if (handler === undefined) throw new Error("expected a handler");
		let started = false;
		act(() =>
		{
			started = handler(uuid);
		});
		return started;
	};
	return {
		view,
		retry,
	};
}

function blocked(message: string): ToastOptions
{
	return {
		kind: "warning",
		message,
		uniqueKey: "hard-block-rerun-blocked",
	};
}

beforeEach(() =>
{
	toasts = [];
	mocks.getComposerText.mockReset();
	mocks.getComposerText.mockReturnValue("");
	mocks.focusComposer.mockReset();
	mocks.focusComposer.mockReturnValue(true);
	mocks.composerInBashMode.mockReset();
	mocks.composerInBashMode.mockReturnValue(false);
});

afterEach(() =>
{
	cleanup();
});

describe("useHardBlockEditRetry", () =>
{
	it("offers no handler when the session can't rewind", () =>
	{
		const {view} = setup(
			{
				available: false,
			},
		);
		expect(view.result.current).toStrictEqual(
			{
				onEditRetry: undefined,
				busyFor: null,
			},
		);
	});

	it("refuses silently when the blocked prompt is no longer the last rewindable one", () =>
	{
		const rewind = vi.fn<Rewind>(async () => {});
		const {retry} = setup(
			{
				block:
				{
					...BLOCK,
					hasMessage: false,
				},
				rewind,
			},
		);
		expect(
			{
				started: retry(),
				toasts,
				calls: rewind.mock.calls.length,
			},
		).toStrictEqual(
			{
				started: false,
				toasts: [],
				calls: 0,
			},
		);
	});

	it("warns with upstream's copy while Claude is working, in bash mode, or over a draft", () =>
	{
		const rewind = vi.fn<Rewind>(async () => {});
		const working = setup(
			{
				busy: true,
				rewind,
			},
		).retry();
		mocks.composerInBashMode.mockReturnValue(true);
		const bash = setup(
			{
				rewind,
			},
		).retry();
		mocks.composerInBashMode.mockReturnValue(false);
		mocks.getComposerText.mockReturnValue("x");
		const draft = setup(
			{
				rewind,
			},
		).retry();
		expect(
			{
				started: [working, bash, draft],
				toasts,
				calls: rewind.mock.calls.length,
			},
		).toStrictEqual(
			{
				started: [false, false, false],
				toasts: [
					blocked("Rewind is unavailable while Claude is working"),
					blocked(
						"Bash mode is on, so nothing was added. Press Backspace in the empty message box to return to chat, then try again.",
					),
					blocked("Clear your draft first, then select Edit and retry."),
				],
				calls: 0,
			},
		);
	});

	it("rewinds to the last prompt, marks the card busy until it settles, and ignores a second click meanwhile", async () =>
	{
		let settle = () =>
		{
		};
		const rewind = vi.fn<Rewind>(
			async () =>
				new Promise<void>((resolve) =>
				{
					settle = resolve;
				}),
		);
		const {view, retry} = setup(
			{
				rewind,
			},
		);
		const first = retry();
		const during = view.result.current.busyFor;
		const second = retry();
		await act(async () =>
		{
			settle();
			await Promise.resolve();
		});
		expect(
			{
				first,
				second,
				during,
				after: view.result.current.busyFor,
				calls: rewind.mock.calls,
				focused: mocks.focusComposer.mock.calls,
			},
		).toStrictEqual(
			{
				first: true,
				second: false,
				during: "r1",
				after: null,
				calls: [["p1", "write the exploit", false]],
				focused: [["s1"]],
			},
		);
	});
});
