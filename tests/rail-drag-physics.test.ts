// @vitest-environment jsdom

import type {Active, ClientRect, Over} from "@dnd-kit/core";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {
	animateRailDrop,
	blurOnPointerDragStart,
	lockRailDragToVerticalAxis,
} from "../src/components/session-rail/rail-drag-physics";

afterEach(() => {
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function stubReducedMotion(reduce: boolean) {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: reduce && query === "(prefers-reduced-motion: reduce)",
		media: query,
	}));
}

function sectionAt(top: number) {
	const element = document.createElement("section");
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect({x: 0, y: top, width: 280, height: 40}),
	);
	const animate = vi.fn<HTMLElement["animate"]>();
	element.animate = animate;
	return {element, animate};
}

describe("lockRailDragToVerticalAxis", () => {
	it("zeroes the horizontal translate and keeps the rest", () => {
		const transform = {x: 37, y: -12, scaleX: 1, scaleY: 1};
		const result = lockRailDragToVerticalAxis({
			transform,
			active: null as Active | null,
			over: null as Over | null,
			activatorEvent: null,
			activeNodeRect: null as ClientRect | null,
			containerNodeRect: null,
			draggingNodeRect: null,
			overlayNodeRect: null,
			scrollableAncestors: [],
			scrollableAncestorRects: [],
			windowRect: null,
		});
		expect(result).toStrictEqual({x: 0, y: -12, scaleX: 1, scaleY: 1});
	});
});

describe("blurOnPointerDragStart", () => {
	it("blurs the focused element on a pointer drag", () => {
		const button = document.createElement("button");
		document.body.append(button);
		button.focus();
		expect(document.activeElement).toBe(button);
		blurOnPointerDragStart(new PointerEvent("pointerdown"));
		expect(document.activeElement).toBe(document.body);
	});

	it("keeps focus on a keyboard drag", () => {
		const button = document.createElement("button");
		document.body.append(button);
		button.focus();
		blurOnPointerDragStart(new KeyboardEvent("keydown", {key: " "}));
		expect(document.activeElement).toBe(button);
	});
});

describe("animateRailDrop", () => {
	it("slides the section from its drop point over 200ms", () => {
		stubReducedMotion(false);
		const {element, animate} = sectionAt(120);
		animateRailDrop(element, 160);
		expect(animate.mock.calls).toStrictEqual([
			[
				[{transform: "translate3d(0,40px,0)"}, {transform: "translate3d(0,0,0)"}],
				{duration: 200, easing: "ease"},
			],
		]);
	});

	it("skips under reduced motion", () => {
		stubReducedMotion(true);
		const {element, animate} = sectionAt(120);
		animateRailDrop(element, 160);
		expect(animate.mock.calls).toStrictEqual([]);
	});

	it("skips a sub-pixel move", () => {
		stubReducedMotion(false);
		const {element, animate} = sectionAt(120);
		animateRailDrop(element, 120.5);
		expect(animate.mock.calls).toStrictEqual([]);
	});
});
