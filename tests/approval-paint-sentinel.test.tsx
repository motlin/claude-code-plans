// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ApprovalPaintSentinel} from "../src/components/approval-paint-sentinel";
import {queueFrames} from "./frame-queue";

describe("ApprovalPaintSentinel", () =>
{
	let shown = true;
	let checkVisibility: ReturnType<typeof vi.fn<(options?: CheckVisibilityOptions) => boolean>>;
	let frameQueue: ReturnType<typeof queueFrames>;

	beforeEach(() =>
	{
		vi.useFakeTimers(
			{
				toFake: ["setInterval", "clearInterval"],
			},
		);
		shown = true;
		checkVisibility = vi.fn<(options?: CheckVisibilityOptions) => boolean>(() => shown);
		HTMLElement.prototype.checkVisibility = checkVisibility;
		frameQueue = queueFrames();
	});

	afterEach(() =>
	{
		cleanup();
		vi.useRealTimers();
		frameQueue.restore();
		Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
	});

	function flushFrame()
	{
		frameQueue.flush();
	}

	function renderSentinel()
	{
		const onPainted = vi.fn<() => void>();
		const onUnpainted = vi.fn<() => void>();
		const view = render(
			<div data-testid="parent">
				<ApprovalPaintSentinel onPainted={onPainted} onUnpainted={onUnpainted} />
			</div>,
		);
		return {
			onPainted,
			onUnpainted,
			view,
		};
	}

	it("reports unpainted on mount and painted after two visible frames, not one", () =>
	{
		const {onPainted, onUnpainted, view} = renderSentinel();
		flushFrame();
		const afterOne = onPainted.mock.calls.length;
		flushFrame();
		expect(
			{
				afterOne,
				painted: onPainted.mock.calls.length,
				unpainted: onUnpainted.mock.calls.length,
				pending: frameQueue.frames.size,
				html: view.getByTestId("parent").innerHTML,
			},
		).toStrictEqual(
			{
				afterOne: 0,
				painted: 1,
				unpainted: 1,
				pending: 0,
				html: '<span hidden=""></span>',
			},
		);
	});

	it("needs two fresh visible frames after an invisible one", () =>
	{
		const {onPainted} = renderSentinel();
		flushFrame();
		shown = false;
		flushFrame();
		shown = true;
		flushFrame();
		const afterOneFresh = onPainted.mock.calls.length;
		flushFrame();
		expect(
			{
				afterOneFresh,
				painted: onPainted.mock.calls.length,
			},
		).toStrictEqual(
			{
				afterOneFresh: 0,
				painted: 1,
			},
		);
	});

	it("stops asking for frames after three invisible ones until a 250ms tick sees it visible", () =>
	{
		const {onPainted} = renderSentinel();
		shown = false;
		flushFrame();
		flushFrame();
		flushFrame();
		const pendingAfterThree = frameQueue.frames.size;
		flushFrame();
		const pendingAfterFour = frameQueue.frames.size;
		vi.advanceTimersByTime(250);
		const pendingWhileHidden = frameQueue.frames.size;
		shown = true;
		vi.advanceTimersByTime(250);
		const pendingOnceShown = frameQueue.frames.size;
		flushFrame();
		flushFrame();
		expect(
			{
				pendingAfterThree,
				pendingAfterFour,
				pendingWhileHidden,
				pendingOnceShown,
				painted: onPainted.mock.calls.length,
			},
		).toStrictEqual(
			{
				pendingAfterThree: 1,
				pendingAfterFour: 0,
				pendingWhileHidden: 0,
				pendingOnceShown: 1,
				painted: 1,
			},
		);
	});

	it("reports unpainted once when a painted parent hides, on the next 250ms tick", () =>
	{
		const {onPainted, onUnpainted} = renderSentinel();
		flushFrame();
		flushFrame();
		shown = false;
		vi.advanceTimersByTime(249);
		const beforeTick = onUnpainted.mock.calls.length;
		vi.advanceTimersByTime(1);
		vi.advanceTimersByTime(500);
		expect(
			{
				beforeTick,
				unpainted: onUnpainted.mock.calls.length,
				painted: onPainted.mock.calls.length,
			},
		).toStrictEqual(
			{
				beforeTick: 1,
				unpainted: 2,
				painted: 1,
			},
		);
	});

	it("asks checkVisibility with upstream's options on the parent", () =>
	{
		renderSentinel();
		flushFrame();
		expect(
			{
				calls: checkVisibility.mock.calls,
				on: checkVisibility.mock.contexts.map((element) => (element as HTMLElement).dataset["testid"]),
			},
		).toStrictEqual(
			{
				calls: [
					[
						{
							checkVisibilityCSS: true,
							contentVisibilityAuto: true,
							visibilityProperty: true,
						},
					],
				],
				on: ["parent"],
			},
		);
	});

	it("counts a browser without checkVisibility as visible", () =>
	{
		Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
		const {onPainted} = renderSentinel();
		flushFrame();
		flushFrame();
		expect(onPainted.mock.calls.length).toBe(1);
	});

	it("clears its poll and frame on unmount", () =>
	{
		const {view} = renderSentinel();
		const before = vi.getTimerCount();
		view.unmount();
		expect(
			{
				before,
				timers: vi.getTimerCount(),
				frames: frameQueue.frames.size,
			},
		).toStrictEqual(
			{
				before: 1,
				timers: 0,
				frames: 0,
			},
		);
	});
});
