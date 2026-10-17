// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ImageViewer} from "../src/components/image-viewer";
import type {AttachedImage} from "../src/components/user-attachments";

const IMAGES: readonly AttachedImage[] = [
	{key: "a", src: "/a.png", label: "Alpha"},
	{key: "b", src: "/b.png", label: "Beta"},
	{key: "c", src: "/c.png", label: "Gamma"},
];

const SLIDE_IMG =
	"max-h-[70vh] max-w-full w-auto h-auto object-contain rounded-2xl motion-safe:transition-opacity motion-safe:duration-300";
const FOCUS_RING = "group-focus-visible/zoomslide:ring-2 group-focus-visible/zoomslide:ring-white/70";
const ACTIVE_IMG = `${SLIDE_IMG} opacity-100 ${FOCUS_RING} cursor-zoom-in`;
const ZOOMED_IMG = `${SLIDE_IMG} opacity-100 ${FOCUS_RING} cursor-zoom-out touch-none translate-z-px`;
const NEIGHBOUR_IMG = `${SLIDE_IMG} opacity-40 hover:opacity-70 cursor-pointer ${FOCUS_RING}`;
const SLIDE = "h-full flex-shrink-0 flex items-center justify-center outline-none";

function Harness({images, initial, onClose}: {images: readonly AttachedImage[]; initial: number; onClose: () => void}) {
	const [index, setIndex] = useState(initial);
	return <ImageViewer images={images} index={index} onIndexChange={setIndex} onClose={onClose} />;
}

function open(initial = 0, images: readonly AttachedImage[] = IMAGES) {
	const onClose = vi.fn<() => void>();
	render(<Harness images={images} initial={initial} onClose={onClose} />);
	const viewer = screen.getByRole("dialog", {name: "Image preview"});
	return {viewer, onClose};
}

function slides(viewer: HTMLElement) {
	return [...viewer.querySelectorAll<HTMLElement>("[data-viewer-slide]")];
}

function count(viewer: HTMLElement) {
	return viewer.querySelector("[aria-live=polite]")?.textContent;
}

function track(viewer: HTMLElement) {
	return viewer.querySelector<HTMLElement>("[data-viewer-track]")!;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** The active image fits at 400x300 centred on (400, 250) inside a 1000x600 stage; natural width 1600 → max 4x. */
const IMG_RECT = {left: 200, top: 100, width: 400, height: 300};
const STAGE_RECT = {left: 0, top: 0, width: 1000, height: 600};

function rect({left, top, width, height}: {left: number; top: number; width: number; height: number}): DOMRect {
	return DOMRect.fromRect({x: left, y: top, width, height});
}

function layOut() {
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
		if (this.tagName === "IMG") return rect(IMG_RECT);
		if (this.hasAttribute("data-viewer-stage")) return rect(STAGE_RECT);
		return rect({left: 0, top: 0, width: 0, height: 0});
	});
	vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1600);
	HTMLElement.prototype.setPointerCapture = () => undefined;
}

function zoomTarget() {
	return screen.getByRole("button", {name: "Zoom image: Alpha"});
}

function zoomOf(viewer: HTMLElement, index = 0) {
	const slide = slides(viewer)[index]!;
	const img = slide.querySelector("img")!;
	return {
		pressed: slide.getAttribute("aria-pressed"),
		slideClass: slide.getAttribute("class"),
		imgClass: img.getAttribute("class"),
		transform: img.style.transform,
	};
}

const UNZOOMED = {pressed: "false", slideClass: `${SLIDE} group/zoomslide`, imgClass: ACTIVE_IMG, transform: ""};

function zoomed(transform: string) {
	return {pressed: "true", slideClass: `${SLIDE} group/zoomslide z-10`, imgClass: ZOOMED_IMG, transform};
}

describe("ImageViewer zoom and pan", () => {
	it("exposes only the active slide as the zoom button, labelled with its alt", () => {
		layOut();
		const {viewer} = open(1, [{key: "p", src: "/p.png", label: "Attached image"}, ...IMAGES]);
		expect({
			buttons: screen.getAllByRole("button", {name: /^Zoom image: /}).map((button) => ({
				name: button.getAttribute("aria-label"),
				tabIndex: button.getAttribute("tabindex"),
				pressed: button.getAttribute("aria-pressed"),
			})),
			roles: slides(viewer).map((slide) => slide.getAttribute("role")),
		}).toStrictEqual({
			buttons: [{name: "Zoom image: Alpha", tabIndex: "0", pressed: "false"}],
			roles: [null, "button", null, null],
		});
		fireEvent.click(screen.getByRole("button", {name: "Previous image"}));
		expect(
			screen.getAllByRole("button", {name: /^Zoom image: /}).map((b) => b.getAttribute("aria-label")),
		).toStrictEqual(["Zoom image: Attached image"]);
	});

	it("zooms to the natural-size scale anchored at the click and restores on a second click", () => {
		layOut();
		const {viewer, onClose} = open(0);
		const img = slides(viewer)[0]!.querySelector("img")!;
		const before = zoomOf(viewer);
		fireEvent.click(img, {clientX: 500, clientY: 300, detail: 1});
		const after = zoomOf(viewer);
		fireEvent.click(img, {clientX: 500, clientY: 300, detail: 1});
		expect({before, after, restored: zoomOf(viewer), closed: onClose.mock.calls.length}).toStrictEqual({
			before: UNZOOMED,
			after: zoomed("translate(-300px, -150px) scale(4)"),
			restored: UNZOOMED,
			closed: 0,
		});
	});

	it("zooms to at least 2x when the image is already shown at natural size", () => {
		layOut();
		vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(400);
		const {viewer} = open(0);
		fireEvent.click(slides(viewer)[0]!.querySelector("img")!, {clientX: 400, clientY: 250, detail: 1});
		expect(zoomOf(viewer).transform).toBe("translate(0px, 0px) scale(2)");
	});

	it("pans a zoomed image by a drag without unzooming", () => {
		layOut();
		const {viewer} = open(0);
		const img = slides(viewer)[0]!.querySelector("img")!;
		fireEvent.click(img, {clientX: 400, clientY: 250, detail: 1});
		fireEvent.pointerDown(img, {pointerId: 1, button: 0, clientX: 400, clientY: 250});
		fireEvent.pointerMove(img, {pointerId: 1, clientX: 440, clientY: 270});
		fireEvent.pointerUp(img, {pointerId: 1, clientX: 440, clientY: 270});
		fireEvent.click(img, {clientX: 440, clientY: 270, detail: 1});
		expect(zoomOf(viewer)).toStrictEqual(zoomed("translate(40px, 20px) scale(4)"));
	});

	it("ignores movement under the 4px drag threshold", () => {
		layOut();
		const {viewer} = open(0);
		const img = slides(viewer)[0]!.querySelector("img")!;
		fireEvent.click(img, {clientX: 400, clientY: 250, detail: 1});
		fireEvent.pointerDown(img, {pointerId: 1, button: 0, clientX: 400, clientY: 250});
		fireEvent.pointerMove(img, {pointerId: 1, clientX: 402, clientY: 252});
		fireEvent.pointerUp(img, {pointerId: 1, clientX: 402, clientY: 252});
		const afterTinyMove = zoomOf(viewer).transform;
		fireEvent.click(img, {clientX: 402, clientY: 252, detail: 1});
		expect({afterTinyMove, afterClick: zoomOf(viewer)}).toStrictEqual({
			afterTinyMove: "translate(0px, 0px) scale(4)",
			afterClick: UNZOOMED,
		});
	});

	it("clamps a pan at the pan limit", () => {
		layOut();
		const {viewer} = open(0);
		const img = slides(viewer)[0]!.querySelector("img")!;
		fireEvent.click(img, {clientX: 400, clientY: 250, detail: 1});
		fireEvent.pointerDown(img, {pointerId: 1, button: 0, clientX: 400, clientY: 250});
		fireEvent.pointerMove(img, {pointerId: 1, clientX: 2400, clientY: -1750});
		fireEvent.pointerUp(img, {pointerId: 1, clientX: 2400, clientY: -1750});
		expect(zoomOf(viewer).transform).toBe("translate(600px, -480px) scale(4)");
	});

	it("resets zoom and pan when navigating", () => {
		layOut();
		const {viewer} = open(0);
		const img = slides(viewer)[0]!.querySelector("img")!;
		fireEvent.click(img, {clientX: 500, clientY: 300, detail: 1});
		fireEvent.click(screen.getByRole("button", {name: "Next image"}));
		const next = zoomOf(viewer, 1);
		fireEvent.click(screen.getByRole("button", {name: "Previous image"}));
		expect({next, back: zoomOf(viewer, 0)}).toStrictEqual({
			next: {...UNZOOMED, transform: ""},
			back: UNZOOMED,
		});
	});

	it("unzooms when the window resizes", () => {
		layOut();
		const {viewer} = open(0);
		fireEvent.click(slides(viewer)[0]!.querySelector("img")!, {clientX: 500, clientY: 300, detail: 1});
		fireEvent(window, new Event("resize"));
		expect(zoomOf(viewer)).toStrictEqual(UNZOOMED);
	});

	it("closes on Escape even while zoomed", () => {
		layOut();
		const {viewer, onClose} = open(0);
		fireEvent.click(slides(viewer)[0]!.querySelector("img")!, {clientX: 500, clientY: 300, detail: 1});
		fireEvent.keyDown(viewer, {key: "Escape"});
		expect(onClose.mock.calls.length).toBe(1);
	});

	it("unzooms instead of closing on a backdrop click, and ignores neighbour clicks while zoomed", () => {
		layOut();
		const {viewer, onClose} = open(0);
		fireEvent.click(slides(viewer)[0]!.querySelector("img")!, {clientX: 500, clientY: 300, detail: 1});
		fireEvent.click(slides(viewer)[1]!, {clientX: 900, clientY: 300});
		const afterNeighbour = {count: count(viewer), zoom: zoomOf(viewer)};
		fireEvent.click(slides(viewer)[0]!.querySelector("img")!, {clientX: 500, clientY: 300, detail: 1});
		fireEvent.click(viewer);
		expect({afterNeighbour, zoom: zoomOf(viewer), closed: onClose.mock.calls.length}).toStrictEqual({
			afterNeighbour: {count: "1 of 3", zoom: UNZOOMED},
			zoom: UNZOOMED,
			closed: 0,
		});
	});

	it("toggles a centred zoom with Enter and Space on the slide", () => {
		layOut();
		const {viewer} = open(0);
		const slide = zoomTarget();
		fireEvent.keyDown(slide, {key: "Enter"});
		const entered = zoomOf(viewer);
		fireEvent.keyDown(slide, {key: " "});
		const spaced = zoomOf(viewer);
		fireEvent.keyDown(slide, {key: " "});
		expect({entered, spaced, again: zoomOf(viewer)}).toStrictEqual({
			entered: zoomed("translate(0px, 0px) scale(4)"),
			spaced: UNZOOMED,
			again: zoomed("translate(0px, 0px) scale(4)"),
		});
	});

	it("has no + / - / 0 or double-click zoom bindings", () => {
		layOut();
		const {viewer} = open(0);
		for (const key of ["+", "=", "-", "0"]) fireEvent.keyDown(slides(viewer)[0]!, {key});
		fireEvent.doubleClick(slides(viewer)[0]!.querySelector("img")!);
		expect(zoomOf(viewer)).toStrictEqual(UNZOOMED);
	});

	it("pinch-zooms with ctrl+wheel anchored at the cursor and snaps back to fit near 1x", () => {
		layOut();
		const {viewer} = open(0);
		const img = slides(viewer)[0]!.querySelector("img")!;
		fireEvent.wheel(img, {ctrlKey: true, deltaY: -100, deltaMode: 0, clientX: 500, clientY: 300});
		const pinched = zoomOf(viewer);
		fireEvent.wheel(img, {ctrlKey: true, deltaY: 100, deltaMode: 0, clientX: 500, clientY: 300});
		expect({pinched, released: zoomOf(viewer)}).toStrictEqual({
			pinched: zoomed(`translate(${100 - 100 * Math.E}px, ${50 - 50 * Math.E}px) scale(${Math.E})`),
			released: UNZOOMED,
		});
	});

	it("makes the first ctrl+wheel step at least 1.25x", () => {
		layOut();
		const {viewer} = open(0);
		fireEvent.wheel(slides(viewer)[0]!.querySelector("img")!, {
			ctrlKey: true,
			deltaY: -1,
			deltaMode: 0,
			clientX: 400,
			clientY: 250,
		});
		expect(zoomOf(viewer).transform).toBe("translate(0px, 0px) scale(1.25)");
	});

	it("pans with the plain wheel only while zoomed, 16px per line", () => {
		layOut();
		const {viewer} = open(0);
		const img = slides(viewer)[0]!.querySelector("img")!;
		fireEvent.wheel(img, {deltaY: 30, deltaMode: 0});
		const unzoomed = zoomOf(viewer);
		fireEvent.click(img, {clientX: 400, clientY: 250, detail: 1});
		fireEvent.wheel(img, {deltaX: -10, deltaY: 30, deltaMode: 0});
		const pixels = zoomOf(viewer).transform;
		fireEvent.wheel(img, {deltaY: 2, deltaMode: 1});
		expect({unzoomed, pixels, lines: zoomOf(viewer).transform}).toStrictEqual({
			unzoomed: UNZOOMED,
			pixels: "translate(10px, -30px) scale(4)",
			lines: "translate(10px, -62px) scale(4)",
		});
	});
});

describe("ImageViewer", () => {
	it("renders every image as a 75vw slide with only the active one at full opacity", () => {
		const {viewer} = open(0);
		expect(
			slides(viewer).map((slide) => {
				const img = slide.querySelector("img")!;
				return {
					alt: img.getAttribute("alt"),
					active: slide.getAttribute("aria-hidden") !== "true",
					width: slide.style.width,
					className: img.getAttribute("class"),
					referrerPolicy: img.getAttribute("referrerpolicy"),
				};
			}),
		).toStrictEqual([
			{alt: "Alpha", active: true, width: "75vw", className: ACTIVE_IMG, referrerPolicy: "no-referrer"},
			{alt: "Beta", active: false, width: "75vw", className: NEIGHBOUR_IMG, referrerPolicy: "no-referrer"},
			{alt: "Gamma", active: false, width: "75vw", className: NEIGHBOUR_IMG, referrerPolicy: "no-referrer"},
		]);
	});

	it("centres the track on the active slide with upstream's transform and transition", () => {
		const {viewer} = open(0);
		const first = {transform: track(viewer).style.transform, gap: track(viewer).style.gap};
		fireEvent.click(screen.getByRole("button", {name: "Next image"}));
		const second = {transform: track(viewer).style.transform, gap: track(viewer).style.gap};
		expect({first, second, className: track(viewer).getAttribute("class")}).toStrictEqual({
			first: {transform: "translateX(calc(12.5vw - 0vw - 0px))", gap: "32px"},
			second: {transform: "translateX(calc(12.5vw - 75vw - 32px))", gap: "32px"},
			className:
				"flex h-full items-center motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out",
		});
	});

	it("selects a neighbour when it is clicked, without closing", () => {
		const {viewer, onClose} = open(0);
		const before = count(viewer);
		fireEvent.click(slides(viewer)[1]!, {clientX: 500, clientY: 300});
		expect({before, after: count(viewer), closed: onClose.mock.calls.length}).toStrictEqual({
			before: "1 of 3",
			after: "2 of 3",
			closed: 0,
		});
	});

	it("stops at the ends instead of wrapping, marking the end button aria-disabled", () => {
		const {viewer} = open(0);
		const previous = screen.getByRole("button", {name: "Previous image"});
		const next = screen.getByRole("button", {name: "Next image"});
		fireEvent.click(previous);
		const atStart = {
			count: count(viewer),
			previous: previous.getAttribute("aria-disabled"),
			next: next.getAttribute("aria-disabled"),
		};
		fireEvent.click(next);
		fireEvent.click(next);
		fireEvent.click(next);
		const atEnd = {
			count: count(viewer),
			previous: previous.getAttribute("aria-disabled"),
			next: next.getAttribute("aria-disabled"),
		};
		expect({
			atStart,
			atEnd,
			nextClass: next.getAttribute("class"),
			previousClass: previous.getAttribute("class"),
		}).toStrictEqual({
			atStart: {count: "1 of 3", previous: "true", next: "false"},
			atEnd: {count: "3 of 3", previous: "false", next: "true"},
			nextClass: "p-2 rounded-lg text-white/30 cursor-default",
			previousClass: "p-2 rounded-lg text-white hover:bg-white/10",
		});
	});

	it("announces the position politely and atomically", () => {
		const {viewer} = open(1);
		const label = viewer.querySelector("[aria-live]")!;
		expect({
			text: label.textContent,
			live: label.getAttribute("aria-live"),
			atomic: label.getAttribute("aria-atomic"),
		}).toStrictEqual({text: "2 of 3", live: "polite", atomic: "true"});
	});

	it("moves right with ArrowRight", () => {
		const {viewer} = open(0);
		fireEvent.keyDown(viewer, {key: "ArrowRight"});
		expect(count(viewer)).toBe("2 of 3");
	});

	it("moves left with ArrowLeft and stops at the first image", () => {
		const {viewer} = open(1);
		fireEvent.keyDown(viewer, {key: "ArrowLeft"});
		fireEvent.keyDown(viewer, {key: "ArrowLeft"});
		expect(count(viewer)).toBe("1 of 3");
	});

	it("jumps to the last image with End", () => {
		const {viewer} = open(0);
		fireEvent.keyDown(viewer, {key: "End"});
		expect(count(viewer)).toBe("3 of 3");
	});

	it("jumps to the first image with Home", () => {
		const {viewer} = open(2);
		fireEvent.keyDown(viewer, {key: "Home"});
		expect(count(viewer)).toBe("1 of 3");
	});

	it("closes on Escape", () => {
		const {viewer, onClose} = open(0);
		fireEvent.keyDown(viewer, {key: "Escape"});
		expect(onClose.mock.calls.length).toBe(1);
	});

	it("closes on a backdrop click but not on the active image or the pager", () => {
		const {viewer, onClose} = open(0);
		fireEvent.click(slides(viewer)[0]!.querySelector("img")!);
		fireEvent.click(viewer.querySelector("[aria-live]")!.parentElement!);
		const beforeBackdrop = onClose.mock.calls.length;
		fireEvent.click(viewer);
		expect({beforeBackdrop, after: onClose.mock.calls.length}).toStrictEqual({beforeBackdrop: 0, after: 1});
	});

	it("shows no pager for a single image", () => {
		const {viewer} = open(0, IMAGES.slice(0, 1));
		expect({
			previous: screen.queryByRole("button", {name: "Previous image"}),
			next: screen.queryByRole("button", {name: "Next image"}),
			count: viewer.querySelector("[aria-live]"),
		}).toStrictEqual({previous: null, next: null, count: null});
	});
});
