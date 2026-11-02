// @vitest-environment jsdom

import {act, cleanup, renderHook} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import type {RewindTurn} from "../src/lib/rewind-picker";

const mocks = vi.hoisted(() => (
{
	sendHerdrRewind: vi.fn<
		(
			sessionId: string,
			target:
			{
				stepsBack: number;
				text: string;
			},
		) => Promise<void>
	>(),
	getComposerText: vi.fn<(sessionId: string) => string | null>(),
	refillComposer: vi.fn<(sessionId: string, text: string) => boolean>(),
	focusComposer: vi.fn<(sessionId: string) => boolean>(),
}));

vi.mock("../src/lib/api/herdr", () => (
{
	sendHerdrRewind: mocks.sendHerdrRewind,
}));
vi.mock("../src/lib/context-attach", () => (
{
	getComposerText: mocks.getComposerText,
	refillComposer: mocks.refillComposer,
	focusComposer: mocks.focusComposer,
}));

const {useRefusalEditRetry, REFUSAL_EDIT_RETRY_BLOCKED, REFUSAL_EDIT_RETRY_DECLINED} =
	await import("../src/hooks/use-refusal-edit-retry");

const TURNS: RewindTurn[] = [
	{
		uuid: "u0",
		text: "first",
	},
	{
		uuid: "u1",
		text: "write the exploit",
	},
	{
		uuid: "u2",
		text: "later",
	},
];

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
	refusedUuid?: string | null;
	available?: boolean;
	turns?: readonly RewindTurn[];
}

function setup({refusedUuid = "u1", available = true, turns = TURNS}: Options = {})
{
	return renderHook(
		() =>
			useRefusalEditRetry(
				{
					sessionId: "s1",
					refusedUuid,
					available,
					turns,
				},
			),
		{
			wrapper,
		},
	);
}

function retry(result: {current: (() => boolean) | undefined}): () => boolean
{
	const handler = result.current;
	if (handler === undefined) throw new Error("expected a handler");
	return handler;
}

const DECLINED_TOAST: ToastOptions =
{
	kind: "warning",
	message: "Couldn’t go back to that message. Use Rewind on the message instead.",
	uniqueKey: "refusal-band-edit-retry-declined",
};

beforeEach(() =>
{
	toasts = [];
	mocks.sendHerdrRewind.mockReset();
	mocks.sendHerdrRewind.mockResolvedValue(undefined);
	mocks.getComposerText.mockReset();
	mocks.getComposerText.mockReturnValue("");
	mocks.refillComposer.mockReset();
	mocks.refillComposer.mockReturnValue(true);
	mocks.focusComposer.mockReset();
	mocks.focusComposer.mockReturnValue(true);
});

afterEach(() =>
{
	cleanup();
});

describe("useRefusalEditRetry", () =>
{
	it("copies upstream's warning copy", () =>
	{
		expect(
			{
				REFUSAL_EDIT_RETRY_BLOCKED,
				REFUSAL_EDIT_RETRY_DECLINED,
			},
		).toStrictEqual(
			{
				REFUSAL_EDIT_RETRY_BLOCKED: "Send or clear your draft first, then select Rewind and retry.",
				REFUSAL_EDIT_RETRY_DECLINED: "Couldn’t go back to that message. Use Rewind on the message instead.",
			},
		);
	});

	it("is undefined without a refused uuid or when rewind is unavailable", () =>
	{
		expect(
			setup(
				{
					refusedUuid: null,
				},
			).result.current,
		).toBeUndefined();
		expect(
			setup(
				{
					available: false,
				},
			).result.current,
		).toBeUndefined();
	});

	it("refuses with a warning while the composer holds a draft", () =>
	{
		mocks.getComposerText.mockReturnValue(" x ");
		const {result} = setup();
		let started = true;
		act(() =>
		{
			started = retry(result)();
		});
		expect(
			{
				started,
				toasts,
				rewinds: mocks.sendHerdrRewind.mock.calls,
			},
		).toStrictEqual(
			{
				started: false,
				toasts: [
					{
						kind: "warning",
						message: "Send or clear your draft first, then select Rewind and retry.",
						uniqueKey: "refusal-band-edit-retry-blocked",
					},
				],
				rewinds: [],
			},
		);
	});

	it("rewinds to the refused prompt and refills the composer with it", async () =>
	{
		const {result} = setup();
		let started = false;
		await act(async () =>
		{
			started = retry(result)();
			await Promise.resolve();
		});
		expect(
			{
				started,
				toasts,
				rewinds: mocks.sendHerdrRewind.mock.calls,
				refills: mocks.refillComposer.mock.calls,
				focused: mocks.focusComposer.mock.calls,
			},
		).toStrictEqual(
			{
				started: true,
				toasts: [],
				rewinds: [
					[
						"s1",
						{
							stepsBack: 2,
							text: "write the exploit",
						},
					],
				],
				refills: [["s1", "write the exploit"]],
				focused: [["s1"], ["s1"]],
			},
		);
	});

	it("ignores a second click while the first retry is in flight", async () =>
	{
		let resolve: () => void = () =>
		{
		};
		mocks.sendHerdrRewind.mockReturnValue(
			new Promise<void>((done) =>
			{
				resolve = done;
			}),
		);
		const {result} = setup();
		let first = false;
		let second = true;
		act(() =>
		{
			first = retry(result)();
			second = retry(result)();
		});
		await act(async () =>
		{
			resolve();
			await Promise.resolve();
		});
		expect(
			{
				first,
				second,
				rewinds: mocks.sendHerdrRewind.mock.calls.length,
				toasts,
			},
		).toStrictEqual(
			{
				first: true,
				second: false,
				rewinds: 1,
				toasts: [],
			},
		);
	});

	it("warns when the refused prompt is unknown", async () =>
	{
		const {result} = setup(
			{
				refusedUuid: "missing",
			},
		);
		let started = true;
		await act(async () =>
		{
			started = retry(result)();
			await Promise.resolve();
		});
		expect(
			{
				started,
				toasts,
				rewinds: mocks.sendHerdrRewind.mock.calls,
			},
		).toStrictEqual(
			{
				started: true,
				toasts: [DECLINED_TOAST],
				rewinds: [],
			},
		);
	});

	it("warns when the refused prompt has no text", async () =>
	{
		const {result} = setup(
			{
				turns: [
					{
						uuid: "u1",
						text: "  ",
					},
				],
			},
		);
		await act(async () =>
		{
			retry(result)();
			await Promise.resolve();
		});
		expect(
			{
				toasts,
				rewinds: mocks.sendHerdrRewind.mock.calls,
			},
		).toStrictEqual(
			{
				toasts: [DECLINED_TOAST],
				rewinds: [],
			},
		);
	});

	it("warns on a rejected rewind and clears the in-flight guard", async () =>
	{
		mocks.sendHerdrRewind.mockRejectedValueOnce(new Error("pane gone"));
		const {result} = setup();
		await act(async () =>
		{
			retry(result)();
			await Promise.resolve();
			await Promise.resolve();
		});
		let again = false;
		await act(async () =>
		{
			again = retry(result)();
			await Promise.resolve();
		});
		expect(
			{
				again,
				toasts,
				rewinds: mocks.sendHerdrRewind.mock.calls.length,
				refills: mocks.refillComposer.mock.calls,
			},
		).toStrictEqual(
			{
				again: true,
				toasts: [DECLINED_TOAST],
				rewinds: 2,
				refills: [["s1", "write the exploit"]],
			},
		);
	});
});
