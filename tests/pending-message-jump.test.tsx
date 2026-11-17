// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, renderHook} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {usePendingMessageJump} from "../src/hooks/use-pending-message-jump";
import {fetchEarlierTranscript} from "../src/lib/api/sessions";
import {jumpToMessage} from "../src/lib/jump-to-message";

vi.mock("../src/lib/api/sessions", () => (
{
	fetchEarlierTranscript: vi.fn<typeof fetchEarlierTranscript>(async () => Promise.resolve(undefined)),
}));
vi.mock("../src/lib/jump-to-message", () => (
{
	jumpToMessage: vi.fn<typeof jumpToMessage>(() => true),
}));

function wrapper({children}: {children: ReactNode})
{
	const client = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

interface WindowProps
{
	hasEarlier: boolean;
	uuidToLine: ReadonlyMap<string, number>;
}

function renderPendingJump(initialProps: WindowProps)
{
	return renderHook(
		({hasEarlier, uuidToLine}: WindowProps) => usePendingMessageJump("session-1", hasEarlier, uuidToLine),
		{
			wrapper,
			initialProps,
		},
	);
}

const HELD = new Map([["u-1700", 1_700]]);
const NOT_HELD = new Map<string, number>();

beforeEach(() =>
{
	vi.mocked(fetchEarlierTranscript).mockClear();
	vi.mocked(jumpToMessage).mockClear();
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
	{
		callback(0);
		return 1;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("usePendingMessageJump", () =>
{
	it("scrolls straight to a message the loaded records already hold", () =>
	{
		const {result} = renderPendingJump(
			{
				hasEarlier: true,
				uuidToLine: HELD,
			},
		);

		act(() =>
		{
			result.current("u-1700");
		});

		expect(
			{
				jumps: vi.mocked(jumpToMessage).mock.calls,
				fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
			},
		).toStrictEqual(
			{
				jumps: [[1_700]],
				fetches: 0,
			},
		);
	});

	it("pages history back for a message the loaded records do not hold, then scrolls to it", () =>
	{
		const {result, rerender} = renderPendingJump(
			{
				hasEarlier: true,
				uuidToLine: NOT_HELD,
			},
		);

		act(() =>
		{
			result.current("u-1700");
		});
		const afterRequest =
		{
			jumps: vi.mocked(jumpToMessage).mock.calls.length,
			fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
		};

		rerender(
			{
				hasEarlier: true,
				uuidToLine: HELD,
			},
		);

		expect(
			{
				afterRequest,
				jumps: vi.mocked(jumpToMessage).mock.calls,
				fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
			},
		).toStrictEqual(
			{
				afterRequest:
				{
					jumps: 0,
					fetches: 1,
				},
				jumps: [[1_700]],
				fetches: 1,
			},
		);
	});

	it("asks for one page at a time while a request is still in flight", () =>
	{
		const {result, rerender} = renderPendingJump(
			{
				hasEarlier: true,
				uuidToLine: NOT_HELD,
			},
		);

		act(() =>
		{
			result.current("u-1700");
		});
		rerender(
			{
				hasEarlier: true,
				uuidToLine: new Map(),
			},
		);

		expect(vi.mocked(fetchEarlierTranscript).mock.calls.length).toBe(1);
	});

	it("stops asking for history once the earlier cursor is lost", async () =>
	{
		vi.mocked(fetchEarlierTranscript).mockResolvedValueOnce("cursor_lost");
		const {result, rerender} = renderPendingJump(
			{
				hasEarlier: true,
				uuidToLine: NOT_HELD,
			},
		);

		act(() =>
		{
			result.current("u-1700");
		});
		await act(async () =>
		{
			await Promise.resolve();
		});
		rerender(
			{
				hasEarlier: false,
				uuidToLine: new Map(),
			},
		);

		expect(vi.mocked(fetchEarlierTranscript).mock.calls.length).toBe(1);
	});

	it("stops asking for history once the window covers the whole file", () =>
	{
		const {result} = renderPendingJump(
			{
				hasEarlier: false,
				uuidToLine: NOT_HELD,
			},
		);

		act(() =>
		{
			result.current("u-1700");
		});

		expect(
			{
				jumps: vi.mocked(jumpToMessage).mock.calls.length,
				fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
			},
		).toStrictEqual(
			{
				jumps: 0,
				fetches: 0,
			},
		);
	});

	it("jumps once, so paging further back does not yank the reader off what they scrolled to", () =>
	{
		const {result, rerender} = renderPendingJump(
			{
				hasEarlier: true,
				uuidToLine: HELD,
			},
		);

		act(() =>
		{
			result.current("u-1700");
		});
		rerender(
			{
				hasEarlier: true,
				uuidToLine: new Map(HELD),
			},
		);
		rerender(
			{
				hasEarlier: true,
				uuidToLine: new Map(HELD),
			},
		);

		expect(vi.mocked(jumpToMessage).mock.calls).toStrictEqual([[1_700]]);
	});

	it("does nothing at all until a chip asks for a message", () =>
	{
		const {rerender} = renderPendingJump(
			{
				hasEarlier: true,
				uuidToLine: NOT_HELD,
			},
		);

		rerender(
			{
				hasEarlier: true,
				uuidToLine: HELD,
			},
		);

		expect(
			{
				jumps: vi.mocked(jumpToMessage).mock.calls.length,
				fetches: vi.mocked(fetchEarlierTranscript).mock.calls.length,
			},
		).toStrictEqual(
			{
				jumps: 0,
				fetches: 0,
			},
		);
	});
});
