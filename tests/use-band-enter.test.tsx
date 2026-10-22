// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {useBandEnter} from "../src/hooks/use-band-enter";

function Slot() {
	const ref = useBandEnter<HTMLDivElement>();
	return <div ref={ref} data-testid="slot" />;
}

describe("useBandEnter (upstream composer band slot)", () => {
	let frames: FrameRequestCallback[];

	beforeEach(() => {
		frames = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
			frames[id - 1] = () => undefined;
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	function runFrame(index: number): void {
		frames[index]?.(0);
	}

	it("sets data-band-enter only after two animation frames", () => {
		const {getByTestId} = render(<Slot />);
		const slot = getByTestId("slot");
		const states: (string | null)[] = [slot.getAttribute("data-band-enter")];
		runFrame(0);
		states.push(slot.getAttribute("data-band-enter"));
		runFrame(1);
		states.push(slot.getAttribute("data-band-enter"));
		expect(states).toStrictEqual([null, null, ""]);
	});

	it("cancels the pending frames when the slot unmounts", () => {
		const {unmount} = render(<Slot />);
		unmount();
		expect(vi.mocked(window.cancelAnimationFrame).mock.calls).toStrictEqual([[1], [0]]);
	});
});

describe("band enter/exit CSS (upstream epitaxy-band-enter / epitaxy-band-exit)", () => {
	const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");

	it("transitions a band in from opacity 0 and a 6px drop over 120ms ease-out", () => {
		expect([
			styles.includes(
				"[data-band-enter] .band-enter { transition-property: opacity, translate, background-color, color; transition-duration: 120ms; transition-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1); }",
			),
			styles.includes("@starting-style { [data-band-enter] .band-enter { opacity: 0; translate: 0 6px; } }"),
		]).toStrictEqual([true, true]);
	});

	it("turns the enter transition off under reduced motion", () => {
		expect(
			styles.includes(
				"@media (prefers-reduced-motion: reduce) { [data-band-enter] .band-enter { transition: none; } }",
			),
		).toBe(true);
	});

	it("animates a band out to opacity 0 and a 6px drop over 120ms ease-out, holding the end state", () => {
		expect([
			styles.includes("@keyframes band-exit { to { opacity: 0; translate: 0 6px; } }"),
			styles.includes(".band-exit { animation: band-exit 120ms cubic-bezier(0.165, 0.84, 0.44, 1) forwards; }"),
		]).toStrictEqual([true, true]);
	});
});
