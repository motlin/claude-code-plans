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

const ACTIVE_IMG =
	"max-h-[70vh] max-w-full w-auto h-auto object-contain rounded-2xl motion-safe:transition-opacity motion-safe:duration-300 opacity-100";
const NEIGHBOUR_IMG =
	"max-h-[70vh] max-w-full w-auto h-auto object-contain rounded-2xl motion-safe:transition-opacity motion-safe:duration-300 opacity-40 hover:opacity-70 cursor-pointer";

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
