// @vitest-environment jsdom

import {act, renderHook} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {useActiveChapter} from "../src/hooks/use-active-chapter";
import type {SessionChapter} from "../src/lib/session-chapters";

const CHAPTERS: SessionChapter[] = [
	{id: "session-start", title: "Session start", source: "session", uuid: "u-0", recordIndex: 0},
	{id: "toolu_plan", title: "Plan", source: "claude", uuid: "a-1", recordIndex: 10},
	{id: "toolu_build", title: "Build", source: "claude", uuid: "a-3", recordIndex: 30},
];

const rect = (top: number, bottom = top) => ({top, bottom}) as DOMRect;

/** A scroller at viewport top 100 (so the reading line is 164) holding one row per record index, each headed by its chapter. */
function buildScroller(rows: readonly {recordIndex: number; top: number; bottom: number; chapterId?: string}[]) {
	const scroller = document.createElement("div");
	scroller.getBoundingClientRect = () => rect(100, 700);
	const geometry = {scrollHeight: 3000, scrollTop: 0, clientHeight: 600};
	for (const key of ["scrollHeight", "scrollTop", "clientHeight"] as const)
		Object.defineProperty(scroller, key, {get: () => geometry[key]});
	const tops = new Map<string, number>();
	for (const row of rows) {
		const element = document.createElement("div");
		element.setAttribute("data-transcript-entry-index", "");
		element.setAttribute("data-perf-line", String(row.recordIndex));
		element.getBoundingClientRect = () => rect(row.top, row.bottom);
		if (row.chapterId !== undefined) {
			const {chapterId} = row;
			tops.set(chapterId, row.top);
			const heading = document.createElement("h3");
			heading.id = `epitaxy-ch-${chapterId}`;
			heading.getBoundingClientRect = () => rect(tops.get(chapterId) ?? 0);
			element.append(heading);
		}
		scroller.append(element);
	}
	document.body.append(scroller);
	return {scroller, geometry, tops};
}

describe("useActiveChapter", () => {
	let frames: FrameRequestCallback[] = [];
	let now = 1000;
	const flushFrame = () => {
		const due = frames;
		frames = [];
		act(() => {
			for (const frame of due) frame(now);
		});
	};

	beforeEach(() => {
		frames = [];
		now = 1000;
		vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
		vi.spyOn(performance, "now").mockImplementation(() => now);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
		vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
			frames[handle - 1] = () => {};
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		document.body.replaceChildren();
	});

	it("is null until its first pass, then follows the scroll one frame behind, and trails the bottom by 50ms", () => {
		const {scroller, geometry, tops} = buildScroller([
			{recordIndex: 0, top: 100, bottom: 300},
			{recordIndex: 10, top: 300, bottom: 500, chapterId: "toolu_plan"},
			{recordIndex: 30, top: 900, bottom: 1100, chapterId: "toolu_build"},
		]);
		const seen: (string | null)[] = [];
		const {result} = renderHook(() => {
			const active = useActiveChapter({chapters: CHAPTERS, scrollRef: {current: scroller}, scrollKey: "visit"});
			seen.push(active);
			return active;
		});
		const firstRender = seen[0];
		const mounted = result.current;

		// The Plan heading scrolls up to the reading line: nothing changes until the frame runs.
		now = 2000;
		tops.set("toolu_plan", 164);
		act(() => {
			scroller.dispatchEvent(new Event("scroll"));
			scroller.dispatchEvent(new Event("scroll"));
		});
		const beforeFrame = {active: result.current, frames: frames.length};
		flushFrame();
		const afterFrame = result.current;

		// At the bottom, a scroll within 50ms of the last pass waits for the trailing timer.
		geometry.scrollTop = 2395;
		now = 2020;
		act(() => {
			scroller.dispatchEvent(new Event("scroll"));
		});
		flushFrame();
		const nearBottomPass = result.current;
		geometry.scrollTop = 2400;
		now = 2040;
		act(() => {
			scroller.dispatchEvent(new Event("scroll"));
		});
		const waiting = {active: result.current, frames: frames.length};
		act(() => {
			vi.advanceTimersByTime(50);
		});
		const timerFired = {active: result.current, frames: frames.length};
		flushFrame();

		expect({
			firstRender,
			mounted,
			beforeFrame,
			afterFrame,
			nearBottomPass,
			waiting,
			timerFired,
			atBottom: result.current,
		}).toStrictEqual({
			firstRender: null,
			mounted: "session-start",
			beforeFrame: {active: "session-start", frames: 1},
			afterFrame: "toolu_plan",
			nearBottomPass: "toolu_build",
			waiting: {active: "toolu_build", frames: 0},
			timerFired: {active: "toolu_build", frames: 1},
			atBottom: "toolu_build",
		});
	});

	it("counts an unmounted chapter that sits before the first row at the reading line", () => {
		const {scroller} = buildScroller([
			{recordIndex: 18, top: -400, bottom: 120},
			{recordIndex: 20, top: 120, bottom: 400},
			{recordIndex: 30, top: 400, bottom: 800, chapterId: "toolu_build"},
		]);
		const {result} = renderHook(() =>
			useActiveChapter({chapters: CHAPTERS, scrollRef: {current: scroller}, scrollKey: "visit"}),
		);

		expect(result.current).toBe("toolu_plan");
	});

	it("retries once on the next frame while no row is mounted, and stops listening on unmount", () => {
		const {scroller} = buildScroller([]);
		const {result, unmount} = renderHook(() =>
			useActiveChapter({chapters: CHAPTERS, scrollRef: {current: scroller}, scrollKey: "visit"}),
		);
		const waiting = {active: result.current, frames: frames.length};
		flushFrame();
		const gaveUp = {active: result.current, frames: frames.length};
		unmount();
		scroller.dispatchEvent(new Event("scroll"));

		expect({waiting, gaveUp, framesAfterUnmount: frames.length}).toStrictEqual({
			waiting: {active: null, frames: 1},
			gaveUp: {active: null, frames: 0},
			framesAfterUnmount: 0,
		});
	});

	it("stays null and does not listen when the session has no outline", () => {
		const {scroller} = buildScroller([{recordIndex: 0, top: 100, bottom: 300}]);
		const {result} = renderHook(() =>
			useActiveChapter({chapters: CHAPTERS.slice(0, 1), scrollRef: {current: scroller}, scrollKey: "visit"}),
		);
		act(() => {
			scroller.dispatchEvent(new Event("scroll"));
		});

		expect({active: result.current, frames: frames.length}).toStrictEqual({active: null, frames: 0});
	});
});
