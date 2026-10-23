// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ImagePreviewModal} from "../src/components/image-preview-modal";

const POPUP = "fixed inset-0 grid place-items-center p-4 sm:p-10 bg-black/62.5 outline-none";
const GROUP_BASE = "inline-flex w-fit shrink-0 flex-col items-stretch gap-2";
const IMG = "block max-w-full max-h-[calc(100vh-4rem)] w-auto h-auto";
const SHADOW =
	"0 4px 32px color-mix(in srgb, black 30%, transparent), 0 0 0 0.5px color-mix(in srgb, black 25%, transparent)";
const MORPH = "chat-image-preview";

const origins: HTMLElement[] = [];

function makeOrigin(): HTMLElement {
	const origin = document.createElement("span");
	origins.push(origin);
	origin.tabIndex = 0;
	document.body.append(origin);
	return origin;
}

function stubMedia({narrow = false, reduce = false}: {narrow?: boolean; reduce?: boolean} = {}) {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: (narrow && query === "(width < 40rem)") || (reduce && query === "(prefers-reduced-motion: reduce)"),
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	}));
}

function stubTransitions() {
	const updates: (() => void)[] = [];
	const start = vi.fn<(update: () => void) => {finished: Promise<void>}>((update) => {
		updates.push(update);
		return {finished: Promise.resolve()};
	});
	Object.defineProperty(document, "startViewTransition", {configurable: true, value: start});
	return {start, updates};
}

function Harness({origin = null, onClose}: {origin?: HTMLElement | null; onClose: () => void}) {
	const [open, setOpen] = useState(true);
	return (
		<ImagePreviewModal
			src="/shot.png"
			alt="shot.png"
			open={open}
			origin={origin}
			onClose={() => {
				onClose();
				setOpen(false);
			}}
		/>
	);
}

function openModal(origin: HTMLElement | null = null) {
	const onClose = vi.fn<() => void>();
	render(<Harness origin={origin} onClose={onClose} />);
	return {dialog: screen.getByRole("dialog"), onClose};
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(document, "startViewTransition");
	document.documentElement.className = "";
	document.documentElement.removeAttribute("style");
	for (const origin of origins.splice(0)) origin.remove();
});

describe("ImagePreviewModal structure", () => {
	it("renders upstream's popup, column, toolbar and image", () => {
		stubMedia();
		const {dialog} = openModal();
		const group = screen.getByRole("group", {name: "Image preview actions"});
		const close = screen.getByRole("button", {name: "Close image preview"});
		const img = dialog.querySelector("img")!;
		const wrapper = img.parentElement!;
		const relative = wrapper.parentElement!;
		const backdrop = document.querySelector<HTMLElement>("[data-image-preview-backdrop]")!;
		expect({
			popup: dialog.getAttribute("class"),
			backdrop: backdrop.getAttribute("class"),
			title: {
				tag: dialog.querySelector("h2")?.tagName,
				class: dialog.querySelector("h2")?.getAttribute("class"),
				text: dialog.querySelector("h2")?.textContent,
			},
			column: relative.parentElement?.getAttribute("class"),
			relative: relative.getAttribute("class"),
			darkScope: group.parentElement?.getAttribute("class"),
			darkMode: group.parentElement?.getAttribute("data-mode"),
			group: group.getAttribute("class"),
			buttons: [...group.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
			closeTestId: close.getAttribute("data-testid"),
			wrapper: wrapper.getAttribute("class"),
			shadow: wrapper.style.boxShadow,
			img: {
				class: img.getAttribute("class"),
				alt: img.getAttribute("alt"),
				src: img.getAttribute("src"),
				decoding: img.getAttribute("decoding"),
			},
		}).toStrictEqual({
			popup: POPUP,
			backdrop: "fixed inset-0 bg-transparent backdrop-blur-none",
			title: {tag: "H2", class: "sr-only", text: "shot.png"},
			column: "max-w-[40rem] w-full",
			relative: "relative w-fit mx-auto",
			darkScope: "dark contents text-primary",
			darkMode: "dark",
			group: `${GROUP_BASE} absolute start-full top-0 ms-1.5`,
			buttons: ["Close image preview"],
			closeTestId: "close-file-preview",
			wrapper: "w-fit rounded-md overflow-hidden",
			shadow: SHADOW,
			img: {class: IMG, alt: "shot.png", src: "/shot.png", decoding: "sync"},
		});
	});

	it("moves the toolbar over the image with on-content buttons below 40rem", () => {
		stubMedia({narrow: true});
		openModal();
		const group = screen.getByRole("group", {name: "Image preview actions"});
		const close = screen.getByRole("button", {name: "Close image preview"});
		expect({
			group: group.getAttribute("class"),
			onContent: close.getAttribute("class")?.split(" ").includes("bg-black/55"),
		}).toStrictEqual({group: `${GROUP_BASE} absolute end-1.5 top-1.5`, onContent: true});
	});

	it("gives the Close button initial focus", async () => {
		stubMedia();
		openModal();
		await act(async () => {
			await new Promise((resolve) => {
				requestAnimationFrame(resolve);
			});
		});
		expect(document.activeElement).toBe(screen.getByRole("button", {name: "Close image preview"}));
	});

	it("prevents dragging the image", () => {
		stubMedia();
		const {dialog} = openModal();
		const img = dialog.querySelector("img")!;
		expect(fireEvent.dragStart(img)).toBe(false);
	});

	it("renders nothing while closed", () => {
		render(<ImagePreviewModal src="/a.png" alt="a" open={false} origin={null} onClose={() => undefined} />);
		expect(screen.queryByRole("dialog")).toBe(null);
	});
});

describe("ImagePreviewModal dismissal", () => {
	it.each([
		["the popup", (dialog: HTMLElement) => dialog],
		["the image", (dialog: HTMLElement) => dialog.querySelector("img")!],
		["Close", () => screen.getByRole("button", {name: "Close image preview"})],
	])("closes on a click on %s", (_name, target) => {
		stubMedia();
		const {dialog, onClose} = openModal();
		fireEvent.click(target(dialog));
		expect({calls: onClose.mock.calls.length, open: screen.queryByRole("dialog") !== null}).toStrictEqual({
			calls: 1,
			open: false,
		});
	});

	it("closes on Escape", () => {
		stubMedia();
		const {dialog, onClose} = openModal();
		fireEvent.keyDown(dialog, {key: "Escape"});
		expect(onClose.mock.calls.length).toBe(1);
	});

	it.each([
		["the toolbar gap", () => screen.getByRole("group", {name: "Image preview actions"})],
		["the image column", (dialog: HTMLElement) => dialog.querySelector("img")!.parentElement!.parentElement!],
	])("stays open on a click on %s", (_name, target) => {
		stubMedia();
		const {dialog, onClose} = openModal();
		fireEvent.click(target(dialog));
		expect(onClose.mock.calls.length).toBe(0);
	});
});

describe("ImagePreviewModal morph", () => {
	it("hides the origin while open, then restores it and refocuses it on close", () => {
		stubMedia();
		const origin = makeOrigin();
		origin.focus();
		openModal(origin);
		const whileOpen = origin.style.visibility;
		fireEvent.click(screen.getByRole("button", {name: "Close image preview"}));
		expect({
			whileOpen,
			afterClose: origin.style.visibility,
			focused: document.activeElement === origin,
		}).toStrictEqual({whileOpen: "hidden", afterClose: "", focused: true});
	});

	it("starts no view transition under prefers-reduced-motion", () => {
		stubMedia({reduce: true});
		const {start} = stubTransitions();
		openModal(makeOrigin());
		fireEvent.click(screen.getByRole("button", {name: "Close image preview"}));
		expect({calls: start.mock.calls.length, open: screen.queryByRole("dialog") !== null}).toStrictEqual({
			calls: 0,
			open: false,
		});
	});

	it("morphs the origin into the image on open and back on close", () => {
		stubMedia();
		const {start, updates} = stubTransitions();
		const origin = makeOrigin();
		origin.style.borderRadius = "12px";
		const {dialog} = openModal(origin);
		const img = dialog.querySelector("img")!;
		const html = document.documentElement;
		const beforeOpen = {
			origin: origin.style.viewTransitionName,
			html: html.className,
			sourceRadius: html.style.getPropertyValue("--vt-image-preview-source-radius"),
		};
		act(() => {
			updates[0]!();
		});
		const afterOpen = {
			origin: origin.style.viewTransitionName,
			visibility: origin.style.visibility,
			img: img.style.viewTransitionName,
		};
		fireEvent.click(screen.getByRole("button", {name: "Close image preview"}));
		const beforeClose = {
			img: img.style.viewTransitionName,
			html: html.className,
			open: screen.queryByRole("dialog") !== null,
		};
		act(() => {
			updates[1]!();
		});
		expect({
			calls: start.mock.calls.length,
			beforeOpen,
			afterOpen,
			beforeClose,
			afterClose: {
				origin: origin.style.viewTransitionName,
				visibility: origin.style.visibility,
				open: screen.queryByRole("dialog") !== null,
			},
		}).toStrictEqual({
			calls: 2,
			beforeOpen: {origin: MORPH, html: "vt-image-preview-active", sourceRadius: "12px"},
			afterOpen: {origin: "", visibility: "hidden", img: MORPH},
			beforeClose: {img: MORPH, html: "vt-image-preview-active vt-image-preview-closing", open: true},
			afterClose: {origin: MORPH, visibility: "", open: false},
		});
	});

	it("crossfades when there is no origin", () => {
		stubMedia();
		const {start} = stubTransitions();
		openModal(null);
		expect({calls: start.mock.calls.length, html: document.documentElement.className}).toStrictEqual({
			calls: 1,
			html: "vt-image-preview-active vt-image-preview-crossfade",
		});
	});
});
